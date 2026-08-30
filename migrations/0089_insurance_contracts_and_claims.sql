-- ---------------------------------------------------------------------------
-- 0089 — التأمين والمطالبات
-- ---------------------------------------------------------------------------
-- المرحلة التاسعة. لا جداول مكرّرة: `insurance_companies` و
-- `insurance_policies` و`patient_insurance_memberships` و
-- `insurance_preauthorizations` و`insurance_claim_forms` و
-- `insurance_claim_batches` كلها موجودة منذ 0016، وهذه الهجرة تُكملها.
--
-- ما كان مكسورًا أو مفقودًا قبلها:
--
--   1) **ثقب أمني في الموافقات المسبقة.** `app_check_service_eligibility`
--      كانت تقبل **أيّ** موافقة معتمدة للمريض خلال ٩٠ يومًا، ولا تنظر إلى
--      الخدمة التي صدرت لأجلها — والجدول أصلًا **بلا عمود `item_id`**.
--      موافقةٌ واحدة على رنين مغناطيسي كانت تفتح كلّ خدمة تشترط موافقة، لأيّ
--      مبلغ، لثلاثة أشهر.
--   2) **لا عقود.** لا شيء يربط شركة تأمين بقائمة أسعار متفق عليها ولا بمدّة
--      سريان: التسعير كان يقفز مباشرةً إلى «قائمة التأمين» بلا عقدٍ يحكمها.
--   3) **لا تغطية ولا استثناءات.** لا جدول يقول إن خدمةً غير مغطّاة، أو إن
--      نسبة تحمّلها تختلف، أو إن لها سقفًا أو عددًا سنويًا.
--   4) **السقوف غير مستهلَكة.** `default_max_amount` و
--      `default_consultation_limit` و`max_amount_override` موجودة منذ 0016
--      و**لا شيء يحسب كم استُهلك منها**، فالسقف رقم مكتوب لا حدّ فعليّ.
--   5) **لا رفض ولا إعادة تقديم.** `insurance_claim_forms.status` فيه
--      `rejected` بلا `rejection_reason` ولا رابط لإعادة التقديم: المطالبة
--      المرفوضة طريق مسدود.
--   6) **السعر غير مجمَّد.** `sales_invoice_items` لا تحفظ من أين جاء السعر،
--      فتعديل قائمة الأسعار غدًا يجعل فاتورة الأمس بلا تفسير.
--
-- **NPHIES:** تُضاف الحقول التي تحتاجها المنصّة (معرّف الدافع، معرّف الطلب،
-- حالة المزامنة) ولا يُضاف أيّ تكامل ولا أيّ نداء خارجيّ. الحقول جاهزة،
-- والوصل قرار لاحق.
--
-- لا شيء هنا يخصّ الرسائل النصية.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) الشبكات وفئات البوالص
-- ===========================================================================

alter table insurance_companies
  add column if not exists code             text,
  add column if not exists nphies_payer_id  text,
  add column if not exists nphies_enabled   boolean not null default false,
  add column if not exists claim_email      text,
  add column if not exists payment_terms_days integer,
  add column if not exists created_by       uuid references auth.users(id),
  add column if not exists updated_at       timestamptz not null default now(),
  add column if not exists updated_by       uuid references auth.users(id);

comment on column insurance_companies.nphies_payer_id is
  'معرّف الدافع في منصّة نفيس. حقل بيانات فقط — لا تكامل ولا نداء خارجيّ في هذه الهجرة.';

create table if not exists insurance_networks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  company_id      uuid not null references insurance_companies(id),
  code            text,
  name_ar         text not null,
  name_en         text,
  description_ar  text,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);

comment on table insurance_networks is
  'شبكة مزوّدي الخدمة داخل شركة تأمين (VIP، A، B…). البوليصة تنتمي إلى شبكة، والشبكة تحدّد أيّ المنشآت مشمولة.';

alter table insurance_networks enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'insurance_companies_org_id_key') then
    alter table insurance_companies add constraint insurance_companies_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_networks_org_id_key') then
    alter table insurance_networks add constraint insurance_networks_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_networks_company_tenant_fk') then
    alter table insurance_networks add constraint insurance_networks_company_tenant_fk
      foreign key (organization_id, company_id) references insurance_companies(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_policies_org_id_key') then
    alter table insurance_policies add constraint insurance_policies_org_id_key unique (organization_id, id);
  end if;
end $$;

alter table insurance_policies
  add column if not exists network_id      uuid references insurance_networks(id),
  add column if not exists class_value_id  uuid references lookup_values(id),
  add column if not exists effective_from  date,
  add column if not exists effective_to    date,
  add column if not exists annual_limit    numeric,
  add column if not exists deductible_amount numeric,
  add column if not exists notes           text,
  add column if not exists created_by      uuid references auth.users(id),
  add column if not exists updated_at      timestamptz not null default now(),
  add column if not exists updated_by      uuid references auth.users(id);

comment on column insurance_policies.annual_limit is
  'السقف السنوي للبوليصة. الاستهلاك يُحسب في v_membership_limit_usage — لا يُكتب يدويًا.';

-- فئات البوالص قائمةُ بحثٍ لا جدولٌ خاص: 0086 أنشأ نظام القوائم، وإضافة
-- جدولٍ رابع لأربع كلمات إسرافٌ يزيد التعقيد بلا مقابل.
insert into lookup_categories (organization_id, key, name_ar, name_en)
select null, 'insurance_policy_classes', 'فئات البوالص التأمينية', 'Insurance Policy Classes'
where not exists (select 1 from lookup_categories
                   where key = 'insurance_policy_classes' and organization_id is null);

insert into lookup_values (category_id, code, name_ar, name_en, sort_order)
select c.id, v.code, v.ar, v.en, v.ord
  from lookup_categories c
  cross join (values
    ('vip', 'كبار الشخصيات', 'VIP', 10),
    ('a',   'الفئة أ', 'Class A', 20),
    ('b',   'الفئة ب', 'Class B', 30),
    ('c',   'الفئة ج', 'Class C', 40),
    ('d',   'الفئة د', 'Class D', 50)
  ) as v(code, ar, en, ord)
 where c.key = 'insurance_policy_classes' and c.organization_id is null
   and not exists (select 1 from lookup_values lv
                    where lv.category_id = c.id and lv.code = v.code);

-- ===========================================================================
-- 2) العقود
-- ===========================================================================

create table if not exists insurance_contracts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id),
  company_id            uuid not null references insurance_companies(id),
  network_id            uuid references insurance_networks(id),
  contract_number       text,
  name_ar               text not null,
  name_en               text,
  price_list_id         uuid references price_lists(id),
  discount_percent      numeric not null default 0
                          check (discount_percent >= 0 and discount_percent <= 100),
  default_copay_percent numeric check (default_copay_percent >= 0 and default_copay_percent <= 100),
  payment_terms_days    integer,
  claim_submission_days integer,
  effective_from        date not null default current_date,
  effective_to          date,
  status                text not null default 'active'
                          check (status in ('draft','active','suspended','expired','terminated')),
  termination_reason    text,
  notes                 text,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id),
  constraint insurance_contracts_dates_check
    check (effective_to is null or effective_to >= effective_from)
);

comment on table insurance_contracts is
  'عقد المنشأة مع شركة تأمين: قائمة الأسعار المتفق عليها، والخصم، ونسبة التحمّل الافتراضية، ومدّة السريان.';

alter table insurance_contracts enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_org_id_key') then
    alter table insurance_contracts add constraint insurance_contracts_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_company_tenant_fk') then
    alter table insurance_contracts add constraint insurance_contracts_company_tenant_fk
      foreign key (organization_id, company_id) references insurance_companies(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_price_list_tenant_fk') then
    alter table insurance_contracts add constraint insurance_contracts_price_list_tenant_fk
      foreign key (organization_id, price_list_id) references price_lists(organization_id, id) not valid;
  end if;

  -- عقدان ساريان للشركة نفسها في اليوم نفسه يعني سعرين لخدمة واحدة ولا قاعدة
  -- تختار بينهما. المنع في المحرّك لا في الواجهة.
  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_no_overlap') then
    alter table insurance_contracts add constraint insurance_contracts_no_overlap
      exclude using gist (
        organization_id with =,
        company_id      with =,
        daterange(effective_from, effective_to, '[]') with &&
      ) where (status = 'active');
  end if;
end $$;

-- الفسخ بلا سبب مكتوب يترك عقدًا ميتًا لا أحد يعرف لماذا مات — وهو أوّل ما
-- يُسأل عنه حين تعود الشركة للتفاوض.
create or replace function app_guard_contract_status()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('terminated','suspended')
     and old.status is distinct from new.status
     and coalesce(btrim(new.termination_reason), '') = '' then
    raise exception 'فسخ العقد أو إيقافه يحتاج سببًا مكتوبًا';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_contract_status on insurance_contracts;
create trigger trg_guard_contract_status
  before update on insurance_contracts
  for each row execute function app_guard_contract_status();

create index if not exists idx_contracts_active
  on insurance_contracts (organization_id, company_id, effective_from desc)
  where status = 'active';

-- ===========================================================================
-- 3) التغطية والاستثناءات
-- ===========================================================================

create table if not exists insurance_coverage_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id),
  contract_id         uuid references insurance_contracts(id),
  policy_id           uuid references insurance_policies(id),
  scope               text not null check (scope in ('item','category','service_type','all')),
  item_id             uuid references items(id),
  category_value_id   uuid references lookup_values(id),
  medical_service_type text,
  coverage            text not null default 'covered'
                        check (coverage in ('covered','excluded','requires_preauth')),
  copay_percent       numeric check (copay_percent >= 0 and copay_percent <= 100),
  max_amount_per_service numeric,
  max_count_per_year  integer,
  waiting_period_days integer,
  note_ar             text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  -- كل نطاق ومفتاحه: قاعدةٌ نطاقها «صنف» بلا صنف قاعدةٌ لا تنطبق على شيء.
  constraint coverage_scope_key_check check (
    (scope = 'item'         and item_id is not null)
    or (scope = 'category'  and category_value_id is not null)
    or (scope = 'service_type' and medical_service_type is not null)
    or (scope = 'all')
  ),
  -- والقاعدة تتبع عقدًا أو بوليصة، لا شيئًا معلّقًا في الهواء.
  constraint coverage_owner_check check (contract_id is not null or policy_id is not null)
);

comment on table insurance_coverage_rules is
  'تغطية العقد أو البوليصة: مغطّى، مستثنى، أو يشترط موافقة مسبقة — مع نسبة تحمّل وسقف وعدد سنويّ.';

alter table insurance_coverage_rules enable row level security;

create index if not exists idx_coverage_contract
  on insurance_coverage_rules (organization_id, contract_id) where is_active;
create index if not exists idx_coverage_policy
  on insurance_coverage_rules (organization_id, policy_id) where is_active;

-- ===========================================================================
-- 4) الموافقات المسبقة — إغلاق الثقب
-- ===========================================================================

alter table insurance_preauthorizations
  add column if not exists item_id           uuid references items(id),
  add column if not exists visit_id          uuid references patient_visits(id),
  add column if not exists contract_id       uuid references insurance_contracts(id),
  add column if not exists qty               numeric not null default 1 check (qty > 0),
  add column if not exists approved_amount   numeric,
  add column if not exists valid_from        date,
  add column if not exists valid_to          date,
  add column if not exists rejection_reason  text,
  add column if not exists consumed_at       timestamptz,
  add column if not exists consumed_invoice_id uuid references sales_invoices(id),
  add column if not exists reference_number  text,
  add column if not exists updated_at        timestamptz not null default now(),
  add column if not exists updated_by        uuid references auth.users(id);

comment on column insurance_preauthorizations.item_id is
  'الخدمة التي صدرت الموافقة لأجلها. غيابه كان يعني أن أيّ موافقة تفتح كلّ خدمة.';
comment on column insurance_preauthorizations.valid_to is
  'نهاية سريان الموافقة. الفارغ يعني ٩٠ يومًا من الاعتماد — لا «إلى الأبد».';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'insurance_preauthorizations_org_id_key') then
    alter table insurance_preauthorizations add constraint insurance_preauthorizations_org_id_key
      unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'preauth_item_tenant_fk') then
    alter table insurance_preauthorizations add constraint preauth_item_tenant_fk
      foreign key (organization_id, item_id) references items(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'preauth_dates_check') then
    alter table insurance_preauthorizations add constraint preauth_dates_check
      check (valid_to is null or valid_from is null or valid_to >= valid_from) not valid;
  end if;
end $$;

create index if not exists idx_preauth_lookup
  on insurance_preauthorizations (organization_id, patient_id, item_id, status);

/**
 * الموافقة السارية لخدمةٍ بعينها.
 *
 * هذه هي الدالة التي تُغلق الثقب: تطابق **الصنف**، وتحترم نافذة السريان،
 * وتتجاهل الموافقة المستهلَكة. الفارغ يعني: لا موافقة.
 */
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
     and p.status     = 'approved'
     and p.consumed_at is null
     and coalesce(p.valid_from, p.responded_at::date, p.requested_at::date) <= p_as_of
     and coalesce(p.valid_to,
                  coalesce(p.responded_at, p.requested_at)::date + 90) >= p_as_of
     and app_is_member(p.organization_id)
   order by coalesce(p.responded_at, p.requested_at) desc
   limit 1;
$$;

create or replace function app_set_preauth_status(
  p_preauth_id uuid,
  p_status     text,
  p_reason     text default null,
  p_amount     numeric default null,
  p_approval_number text default null,
  p_valid_to   date default null
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
  if v_pa.status <> 'pending' then
    raise exception 'الموافقة % — لا تُغيَّر بعد الردّ', v_pa.status;
  end if;
  if p_status not in ('approved','rejected','expired') then
    raise exception 'حالة غير مقبولة: %', p_status;
  end if;
  if p_status = 'rejected' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'الرفض يحتاج سببًا مكتوبًا';
  end if;
  if p_status = 'approved' and coalesce(btrim(p_approval_number), '') = '' then
    raise exception 'الاعتماد يحتاج رقم موافقة من شركة التأمين';
  end if;

  update insurance_preauthorizations set
    status           = p_status,
    responded_at     = now(),
    approval_number  = case when p_status = 'approved' then btrim(p_approval_number) else approval_number end,
    approved_amount  = case when p_status = 'approved' then coalesce(p_amount, requested_amount) else approved_amount end,
    valid_from       = case when p_status = 'approved' then coalesce(valid_from, current_date) else valid_from end,
    valid_to         = case when p_status = 'approved' then coalesce(p_valid_to, valid_to, current_date + 90) else valid_to end,
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

-- ===========================================================================
-- 5) استهلاك السقوف
-- ===========================================================================

create or replace view v_membership_limit_usage
with (security_invoker = on) as
select
  m.id                     as membership_id,
  m.organization_id,
  m.patient_id,
  m.policy_id,
  p.company_id,
  coalesce(m.max_amount_override, p.annual_limit, p.default_max_amount) as annual_limit,
  coalesce(m.copay_percent_override, p.default_copay_percent, 0)        as copay_percent,
  p.default_consultation_limit,
  m.expiry_date,
  m.eligibility_status,
  m.is_active,
  coalesce(used.amount, 0)  as used_amount,
  case when coalesce(m.max_amount_override, p.annual_limit, p.default_max_amount) is null then null
       else coalesce(m.max_amount_override, p.annual_limit, p.default_max_amount) - coalesce(used.amount, 0)
  end                       as remaining_amount,
  coalesce(used.invoices, 0) as used_invoice_count
from patient_insurance_memberships m
join insurance_policies p on p.id = m.policy_id
left join lateral (
  select sum(i.insurance_share_amount) as amount, count(*) as invoices
    from sales_invoices i
   where i.organization_id = m.organization_id
     and i.patient_id      = m.patient_id
     and i.is_insurance_invoice
     and i.status <> 'void'
     -- السنة التأمينية تُحسب من بداية العام الميلادي ما لم يحدّد العقد غير
     -- ذلك: تقريبٌ صريح خيرٌ من سقفٍ لا يُستهلك أبدًا.
     and i.created_at >= date_trunc('year', current_date)
) used on true;

comment on view v_membership_limit_usage is
  'السقف السنوي للعضوية وما استُهلك منه فعلًا. قبل هذا كان السقف رقمًا مكتوبًا لا حدًّا.';

-- ===========================================================================
-- 6) تسوية التغطية — الدالة التي تجيب: أيُغطَّى؟ وكم يدفع المريض؟
-- ===========================================================================

create or replace function app_active_insurance_contract(
  p_organization_id uuid,
  p_company_id      uuid,
  p_as_of           date default current_date
)
returns insurance_contracts
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.* from insurance_contracts c
   where c.organization_id = p_organization_id
     and c.company_id      = p_company_id
     and c.status          = 'active'
     and c.effective_from <= p_as_of
     and (c.effective_to is null or c.effective_to >= p_as_of)
     and app_is_member(p_organization_id)
   order by c.effective_from desc
   limit 1;
$$;

/**
 * تغطية خدمةٍ لعضوية مريض.
 *
 * ترتيب الخصوصية في قواعد التغطية: **الصنف** ثم **الفئة** ثم **نوع الخدمة**
 * ثم **الكل**، وقاعدة العقد تسبق قاعدة البوليصة عند التساوي — لأن العقد أخصّ
 * بهذه المنشأة من بوليصةٍ عامة.
 *
 * تُعيد jsonb فيه: `covered`، `reason`، `copay_percent`، `patient_share`،
 * `insurer_share`، `requires_preauth`، `has_preauth`، `blocks`، `warnings`.
 */
create or replace function app_insurance_coverage(
  p_membership_id uuid,
  p_item_id       uuid,
  p_amount        numeric default null,
  p_as_of         date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m        patient_insurance_memberships%rowtype;
  v_policy   insurance_policies%rowtype;
  v_contract insurance_contracts%rowtype;
  v_item     items%rowtype;
  v_rule     insurance_coverage_rules%rowtype;
  v_usage    record;
  v_amount   numeric;
  v_copay    numeric;
  v_patient  numeric;
  v_insurer  numeric;
  v_blocks   text[] := '{}';
  v_warn     text[] := '{}';
  v_preauth  insurance_preauthorizations%rowtype;
  v_needs_pa boolean := false;
  v_used_cnt integer;
begin
  select * into v_m from patient_insurance_memberships where id = p_membership_id;
  if v_m.id is null then raise exception 'العضوية التأمينية غير موجودة'; end if;
  if not app_is_member(v_m.organization_id) then raise exception 'لا صلاحية'; end if;

  select * into v_policy from insurance_policies where id = v_m.policy_id;
  select * into v_item   from items where id = p_item_id and organization_id = v_m.organization_id;
  if v_item.id is null then raise exception 'الخدمة غير موجودة في هذه المنشأة'; end if;

  v_contract := app_active_insurance_contract(v_m.organization_id, v_policy.company_id, p_as_of);

  -- ── العضوية نفسها
  if not v_m.is_active then
    v_blocks := array_append(v_blocks, 'العضوية التأمينية غير نشطة');
  end if;
  if v_m.expiry_date is not null and v_m.expiry_date < p_as_of then
    v_blocks := array_append(v_blocks, format('العضوية منتهية بتاريخ %s', v_m.expiry_date));
  end if;
  if v_m.eligibility_status = 'not_eligible' then
    v_blocks := array_append(v_blocks, 'المريض غير مؤهَّل لدى شركة التأمين');
  elsif v_m.eligibility_status in ('unknown', 'expired') then
    v_warn := array_append(v_warn, 'أهلية المريض غير محدَّثة — تحقّق قبل التنفيذ');
  end if;
  if v_contract.id is null then
    v_warn := array_append(v_warn,
      'لا عقد ساري مع شركة التأمين في هذا التاريخ — التسعير سيرجع إلى قائمة التأمين أو الأساس');
  end if;

  -- ── قاعدة التغطية الأخصّ
  select * into v_rule
    from insurance_coverage_rules r
   where r.organization_id = v_m.organization_id
     and r.is_active
     and (r.contract_id = v_contract.id or r.policy_id = v_m.policy_id)
     and (
          (r.scope = 'item'         and r.item_id = p_item_id)
       or (r.scope = 'category'     and r.category_value_id = v_item.category_value_id)
       or (r.scope = 'service_type' and r.medical_service_type = v_item.medical_service_type)
       or (r.scope = 'all')
     )
   order by case r.scope when 'item' then 1 when 'category' then 2
                         when 'service_type' then 3 else 4 end,
            case when r.contract_id is not null then 1 else 2 end
   limit 1;

  if v_rule.id is not null and v_rule.coverage = 'excluded' then
    v_blocks := array_append(v_blocks,
      coalesce(nullif(btrim(v_rule.note_ar), ''), 'الخدمة مستثناة من التغطية'));
  end if;

  -- ── الموافقة المسبقة: من القاعدة أو من الصنف
  v_needs_pa := coalesce(v_rule.coverage = 'requires_preauth', false)
                or coalesce(v_item.requires_preauthorization, false);
  if v_needs_pa then
    v_preauth := app_active_preauthorization(v_m.patient_id, p_item_id, p_as_of);
    if v_preauth.id is null then
      v_blocks := array_append(v_blocks, 'تتطلّب موافقة تأمين مسبقة لهذه الخدمة، ولا توجد موافقة سارية');
    end if;
  end if;

  -- ── فترة الانتظار: العضوية الحديثة لا تُغطّى قبل مرورها
  if v_rule.waiting_period_days is not null and v_rule.waiting_period_days > 0 then
    if v_m.created_at::date + v_rule.waiting_period_days > p_as_of then
      v_blocks := array_append(v_blocks,
        format('فترة الانتظار %s يومًا لم تنتهِ بعد (تنتهي %s)',
               v_rule.waiting_period_days,
               v_m.created_at::date + v_rule.waiting_period_days));
    end if;
  end if;

  -- ── العدد السنوي
  if v_rule.max_count_per_year is not null then
    select count(*) into v_used_cnt
      from sales_invoice_items li
      join sales_invoices inv on inv.id = li.invoice_id
     where li.item_id = p_item_id
       and inv.patient_id = v_m.patient_id
       and inv.organization_id = v_m.organization_id
       and inv.is_insurance_invoice
       and inv.status <> 'void'
       and inv.created_at >= date_trunc('year', p_as_of::timestamptz);
    if v_used_cnt >= v_rule.max_count_per_year then
      v_blocks := array_append(v_blocks,
        format('استُهلك العدد المسموح سنويًا لهذه الخدمة (%s)', v_rule.max_count_per_year));
    end if;
  end if;

  -- ── المبلغ ونسبة التحمّل
  v_amount := coalesce(p_amount, (select price from app_resolve_item_price(
                 v_m.organization_id, p_item_id, null, v_policy.company_id, null, p_as_of)), 0);

  if v_rule.max_amount_per_service is not null and v_amount > v_rule.max_amount_per_service then
    v_warn := array_append(v_warn,
      format('سقف الخدمة %s والمبلغ %s — الفرق على المريض',
             v_rule.max_amount_per_service, v_amount));
  end if;

  v_copay := coalesce(v_rule.copay_percent, v_m.copay_percent_override,
                      v_contract.default_copay_percent, v_policy.default_copay_percent, 0);

  select * into v_usage from v_membership_limit_usage where membership_id = p_membership_id;
  if v_usage.remaining_amount is not null and v_usage.remaining_amount <= 0 then
    v_blocks := array_append(v_blocks, 'استُهلك السقف السنوي للعضوية بالكامل');
  elsif v_usage.remaining_amount is not null and v_usage.remaining_amount < v_amount then
    v_warn := array_append(v_warn,
      format('المتبقّي من السقف السنوي %s والمبلغ %s — الفرق على المريض',
             round(v_usage.remaining_amount, 2), v_amount));
  end if;

  v_insurer := round(v_amount * (100 - v_copay) / 100, 2);
  if v_rule.max_amount_per_service is not null then
    v_insurer := least(v_insurer, v_rule.max_amount_per_service);
  end if;
  if v_usage.remaining_amount is not null then
    v_insurer := least(v_insurer, greatest(v_usage.remaining_amount, 0));
  end if;
  if cardinality(v_blocks) > 0 then
    v_insurer := 0;
  end if;
  v_patient := round(v_amount - v_insurer, 2);

  return jsonb_build_object(
    'ok',              cardinality(v_blocks) = 0,
    'covered',         cardinality(v_blocks) = 0,
    'amount',          v_amount,
    'copay_percent',   v_copay,
    'patient_share',   v_patient,
    'insurer_share',   v_insurer,
    'requires_preauth', v_needs_pa,
    'has_preauth',     v_preauth.id is not null,
    'approval_number', v_preauth.approval_number,
    'contract_id',     v_contract.id,
    'contract_name',   v_contract.name_ar,
    'rule_scope',      v_rule.scope,
    'annual_remaining', v_usage.remaining_amount,
    'blocks',          to_jsonb(v_blocks),
    'warnings',        to_jsonb(v_warn)
  );
end;
$$;

-- ===========================================================================
-- 7) التسعير: العقد فوق قائمة التأمين، والسعر يُجمَّد على الفاتورة
-- ===========================================================================

/**
 * ترتيب التسعير الكامل: **عقد الشركة** ← قائمة التأمين ← قائمة الفرع ←
 * قائمة الأساس ← سعر الصنف.
 *
 * العقد يسبق لأنه اتفاقٌ موقَّع بين هذه المنشأة وهذه الشركة، وقائمة التأمين
 * العامة قد تكون أقدم منه أو موضوعة لشركة أخرى من المجموعة نفسها.
 */
create or replace function app_resolve_item_price_v2(
  p_organization_id uuid,
  p_item_id         uuid,
  p_branch_id       uuid default null,
  p_insurance_company_id uuid default null,
  p_external_client_id   uuid default null,
  p_as_of           date default current_date
)
returns table (
  price numeric, discount_percent numeric, source_kind text,
  source_list_id uuid, source_list_name text, contract_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract insurance_contracts%rowtype;
  v_row      record;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا صلاحية';
  end if;

  if p_insurance_company_id is not null then
    v_contract := app_active_insurance_contract(p_organization_id, p_insurance_company_id, p_as_of);
  end if;

  -- قائمة العقد أولًا
  if v_contract.price_list_id is not null then
    select pli.price, coalesce(pli.discount_percent, v_contract.discount_percent),
           'contract'::text, pl.id, pl.name
      into v_row
      from price_list_items pli
      join price_lists pl on pl.id = pli.price_list_id
     where pli.item_id = p_item_id
       and pl.id = v_contract.price_list_id
       and pl.is_active
       and pli.effective_from <= p_as_of
       and (pli.effective_to is null or pli.effective_to >= p_as_of)
     limit 1;
    if found then
      price := v_row.price; discount_percent := v_row.coalesce;
      source_kind := 'contract'; source_list_id := v_row.id; source_list_name := v_row.name;
      contract_id := v_contract.id;
      return next;
      return;
    end if;
  end if;

  -- ثم السُّلَّم القائم منذ 0064
  for v_row in
    select * from app_resolve_item_price(p_organization_id, p_item_id, p_branch_id,
                                         p_insurance_company_id, p_external_client_id, p_as_of)
  loop
    price := v_row.price;
    -- خصم العقد يُطبَّق فوق قائمةٍ أدنى إن لم يكن للعقد قائمة خاصة
    discount_percent := greatest(coalesce(v_row.discount_percent, 0),
                                 coalesce(v_contract.discount_percent, 0));
    source_kind      := v_row.source_kind;
    source_list_id   := v_row.source_list_id;
    source_list_name := v_row.source_list_name;
    contract_id      := v_contract.id;
    return next;
  end loop;
end;
$$;

-- السعر يُجمَّد على السطر: بلا هذا تصير فاتورة الأمس بلا تفسير بعد تعديل
-- قائمة الأسعار اليوم.
alter table sales_invoice_items
  add column if not exists price_source_kind    text,
  add column if not exists price_source_list_id uuid references price_lists(id),
  add column if not exists contract_id          uuid references insurance_contracts(id),
  add column if not exists list_price           numeric,
  add column if not exists covered_amount       numeric,
  add column if not exists patient_share        numeric,
  add column if not exists insurer_share        numeric,
  add column if not exists preauthorization_id  uuid references insurance_preauthorizations(id);

comment on column sales_invoice_items.price_source_kind is
  'من أين جاء السعر لحظة الفوترة: contract أو insurance أو corporate أو branch أو base أو item. مجمَّد ولا يُعاد حسابه.';

-- ===========================================================================
-- 8) المطالبات: الرفض وإعادة التقديم
-- ===========================================================================

alter table insurance_claim_forms
  add column if not exists batch_id            uuid references insurance_claim_batches(id),
  add column if not exists membership_snapshot jsonb,
  add column if not exists claimed_amount      numeric,
  add column if not exists approved_amount     numeric,
  add column if not exists rejected_amount     numeric,
  add column if not exists rejection_code      text,
  add column if not exists rejection_reason    text,
  add column if not exists resubmission_of_id  uuid references insurance_claim_forms(id),
  add column if not exists resubmission_count  integer not null default 0,
  add column if not exists submitted_at        timestamptz,
  add column if not exists responded_at        timestamptz,
  add column if not exists paid_at             timestamptz,
  add column if not exists nphies_request_id   text,
  add column if not exists nphies_status       text,
  add column if not exists nphies_last_sync_at timestamptz,
  add column if not exists updated_by          uuid references auth.users(id);

comment on column insurance_claim_forms.nphies_request_id is
  'معرّف الطلب في نفيس. حقل بيانات فقط — لا تكامل في هذه الهجرة، ولا نداء خارجيّ.';
comment on column insurance_claim_forms.resubmission_of_id is
  'المطالبة الأصلية التي أُعيد تقديم هذه بدلًا عنها. الرفض ليس طريقًا مسدودًا.';

do $$
begin
  alter table insurance_claim_forms drop constraint if exists insurance_claim_forms_status_check;
  alter table insurance_claim_forms add constraint insurance_claim_forms_status_check check (
    status in ('draft','submitted','approved','partially_approved','rejected','resubmitted','paid','cancelled')
  );
  if not exists (select 1 from pg_constraint where conname = 'insurance_claim_forms_org_id_key') then
    alter table insurance_claim_forms add constraint insurance_claim_forms_org_id_key
      unique (organization_id, id);
  end if;
end $$;

alter table insurance_claim_batches
  add column if not exists contract_id     uuid references insurance_contracts(id),
  add column if not exists approved_amount numeric,
  add column if not exists rejected_amount numeric,
  add column if not exists paid_amount     numeric,
  add column if not exists paid_at         timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists responded_at    timestamptz,
  add column if not exists updated_at      timestamptz not null default now(),
  add column if not exists updated_by      uuid references auth.users(id);

create or replace function app_claim_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'              then p_to in ('submitted','cancelled')
    when 'submitted'          then p_to in ('approved','partially_approved','rejected','cancelled')
    when 'approved'           then p_to in ('paid','rejected')
    when 'partially_approved' then p_to in ('paid','resubmitted','rejected')
    when 'rejected'           then p_to in ('resubmitted','cancelled')
    else false   -- paid و resubmitted و cancelled نهائية
  end;
$$;

create or replace function app_set_claim_form_status(
  p_form_id  uuid,
  p_status   text,
  p_reason   text default null,
  p_amount   numeric default null,
  p_code     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f insurance_claim_forms%rowtype;
begin
  select * into v_f from insurance_claim_forms where id = p_form_id for update;
  if v_f.id is null then raise exception 'المطالبة غير موجودة'; end if;
  if not app_has_permission(v_f.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بإدارة المطالبات (insurance.claims)';
  end if;
  if v_f.status = p_status then return; end if;
  if not app_claim_status_allowed(v_f.status, p_status) then
    raise exception 'لا يمكن الانتقال بالمطالبة من «%» إلى «%»', v_f.status, p_status;
  end if;

  -- الرفض والاعتماد الجزئي بلا سبب مكتوب لا يُبنى عليهما اعتراض ولا إعادة
  -- تقديم: يبقى الأثر «مرفوضة» ولا أحد يعرف لماذا.
  if p_status in ('rejected','partially_approved')
     and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'الرفض أو الاعتماد الجزئي يحتاج سببًا مكتوبًا';
  end if;
  if p_status = 'partially_approved' and p_amount is null then
    raise exception 'الاعتماد الجزئي يحتاج المبلغ المعتمَد';
  end if;

  update insurance_claim_forms set
    status          = p_status,
    submitted_at    = case when p_status = 'submitted' then now() else submitted_at end,
    responded_at    = case when p_status in ('approved','partially_approved','rejected')
                           then now() else responded_at end,
    paid_at         = case when p_status = 'paid' then now() else paid_at end,
    approved_amount = case when p_status = 'approved' then coalesce(p_amount, claimed_amount)
                           when p_status = 'partially_approved' then p_amount
                           else approved_amount end,
    rejected_amount = case when p_status = 'rejected' then claimed_amount
                           when p_status = 'partially_approved'
                             then greatest(coalesce(claimed_amount, 0) - coalesce(p_amount, 0), 0)
                           else rejected_amount end,
    rejection_reason = case when p_status in ('rejected','partially_approved')
                            then btrim(p_reason) else rejection_reason end,
    rejection_code  = case when p_status in ('rejected','partially_approved')
                           then nullif(btrim(coalesce(p_code, '')), '') else rejection_code end,
    updated_at      = now(),
    updated_by      = auth.uid()
  where id = p_form_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_f.organization_id, auth.uid(), 'insurance', 'update', p_form_id,
          'مطالبة تأمين', format('%s ← %s', v_f.status, p_status),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

/**
 * إعادة تقديم مطالبة مرفوضة.
 *
 * تُنشئ **مطالبة جديدة** تحمل سطور الأصل، وتترك الأصل مرفوضًا موسومًا
 * بـ`resubmitted`. لا تُعدَّل المطالبة المرفوضة في مكانها: تاريخُ ما قُدِّم
 * ومتى ورُدَّ بأيّ سبب هو نصف الملفّ في أيّ نزاع مع شركة تأمين.
 */
create or replace function app_resubmit_claim_form(
  p_form_id uuid,
  p_note    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f   insurance_claim_forms%rowtype;
  v_new uuid;
begin
  select * into v_f from insurance_claim_forms where id = p_form_id for update;
  if v_f.id is null then raise exception 'المطالبة غير موجودة'; end if;
  if not app_has_permission(v_f.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بإعادة التقديم (insurance.claims)';
  end if;
  if v_f.status not in ('rejected','partially_approved') then
    raise exception 'إعادة التقديم للمطالبات المرفوضة أو المعتمَدة جزئيًا فقط';
  end if;

  insert into insurance_claim_forms (
    organization_id, form_type, patient_id, doctor_id, clinic_id, membership_id,
    sales_invoice_id, status, form_data, auto_created, claimed_amount,
    membership_snapshot, resubmission_of_id, resubmission_count, created_by)
  values (
    v_f.organization_id, v_f.form_type, v_f.patient_id, v_f.doctor_id, v_f.clinic_id,
    v_f.membership_id, v_f.sales_invoice_id, 'draft',
    coalesce(v_f.form_data, '{}'::jsonb)
      || jsonb_build_object('resubmission_note', nullif(btrim(coalesce(p_note, '')), '')),
    false, v_f.claimed_amount, v_f.membership_snapshot, p_form_id,
    v_f.resubmission_count + 1, auth.uid())
  returning id into v_new;

  insert into insurance_claim_form_items (form_id, item_id, service_code, description, qty, amount)
  select v_new, item_id, service_code, description, qty, amount
    from insurance_claim_form_items where form_id = p_form_id;

  update insurance_claim_forms
     set status = 'resubmitted', updated_at = now(), updated_by = auth.uid()
   where id = p_form_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_f.organization_id, auth.uid(), 'insurance', 'add', v_new,
          'مطالبة تأمين', format('إعادة تقديم للمطالبة %s (المحاولة %s)',
                                 p_form_id, v_f.resubmission_count + 1),
          nullif(btrim(coalesce(p_note, '')), ''));

  return v_new;
end;
$$;

-- المطالبة المقدَّمة أو ما بعدها لا تُعدَّل مباشرةً
create or replace function app_guard_submitted_claim()
returns trigger
language plpgsql
as $$
begin
  -- المرفوضة محميّة كالمقدَّمة: هي **دليل** ما قُدِّم وما رُدَّ به، وتعديلها
  -- في مكانها يمحو أساس أيّ اعتراض. التغيير يكون بإعادة تقديم بنسخة جديدة.
  if old.status in ('submitted','approved','partially_approved','paid','resubmitted',
                    'rejected','cancelled')
     and new.status = old.status
     and (new.form_data       is distinct from old.form_data
       or new.sales_invoice_id is distinct from old.sales_invoice_id
       or new.membership_id   is distinct from old.membership_id
       or new.claimed_amount  is distinct from old.claimed_amount) then
    raise exception 'المطالبة المقدَّمة لا تُعدَّل — أعد تقديمها بنسخة جديدة';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_submitted_claim on insurance_claim_forms;
create trigger trg_guard_submitted_claim
  before update on insurance_claim_forms
  for each row execute function app_guard_submitted_claim();

-- ===========================================================================
-- 9) الصلاحيات
-- ===========================================================================

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('insurance.view',      'عرض التأمين والمطالبات',   'insurance', 960),
  ('insurance.manage',    'إدارة الشركات والبوالص',   'insurance', 962),
  ('insurance.contracts', 'إدارة العقود والتغطية',    'insurance', 964),
  ('insurance.preauth',   'إدارة الموافقات المسبقة',  'insurance', 966),
  ('insurance.claims',    'إدارة المطالبات ودفعاتها', 'insurance', 968)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('receptionist',   'insurance.view'), ('receptionist', 'insurance.preauth'),
  ('nurse',          'insurance.view'),
  ('doctor',         'insurance.view'),
  ('accountant',     'insurance.view'), ('accountant', 'insurance.claims'),
  ('branch_manager', 'insurance.view'), ('branch_manager', 'insurance.manage'),
  ('branch_manager', 'insurance.contracts'), ('branch_manager', 'insurance.preauth'),
  ('branch_manager', 'insurance.claims')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('insurance_companies',            'insurance.view', 'insurance.manage'),
      ('insurance_policies',             'insurance.view', 'insurance.manage'),
      ('insurance_networks',             'insurance.view', 'insurance.manage'),
      ('insurance_contracts',            'insurance.view', 'insurance.contracts'),
      ('insurance_coverage_rules',       'insurance.view', 'insurance.contracts'),
      ('patient_insurance_memberships',  'insurance.view', 'insurance.manage'),
      ('insurance_preauthorizations',    'insurance.view', 'insurance.preauth'),
      ('insurance_claim_forms',          'insurance.view', 'insurance.claims'),
      ('insurance_claim_batches',        'insurance.view', 'insurance.claims')
    ) as v(t, pv, pw)
  loop
    -- الإسقاط **بالبحث لا بالاسم**: أسماء السياسات القديمة تختلف من هجرة
    -- لأخرى (`claim_forms_all_members` لا `insurance_claim_forms_all_members`)،
    -- والحذف بالاسم المخمَّن يترك الباب مفتوحًا وهو يظنّ أنه أغلقه.
    declare pol record;
    begin
      for pol in select policyname from pg_policies
                  where schemaname = 'public' and tablename = r.t
      loop
        execute format('drop policy if exists %I on %I', pol.policyname, r.t);
      end loop;
    end;
    execute format('alter table %I enable row level security', r.t);
    execute format(
      'create policy %I on %I for select using (app_has_permission(organization_id, %L))',
      r.t || '_select', r.t, r.pv);
    execute format(
      'create policy %I on %I for insert with check (app_has_permission(organization_id, %L))',
      r.t || '_insert', r.t, r.pw);
    execute format(
      'create policy %I on %I for update using (app_has_permission(organization_id, %L)) with check (app_has_permission(organization_id, %L))',
      r.t || '_update', r.t, r.pw, r.pw);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('insurance_claim_form_items',  'insurance_claim_forms',   'form_id'),
      ('insurance_claim_batch_items', 'insurance_claim_batches', 'batch_id')
    ) as v(t, parent, fk)
  loop
    execute format('alter table %I enable row level security', r.t);
    declare pol record;
    begin
      for pol in select policyname from pg_policies
                  where schemaname = 'public' and tablename = r.t
      loop
        execute format('drop policy if exists %I on %I', pol.policyname, r.t);
      end loop;
    end;
    execute format(
      'create policy %I on %I for select using (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L)))',
      r.t || '_select', r.t, r.parent, r.t, r.fk, 'insurance.view');
    execute format(
      'create policy %I on %I for all using (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L))) with check (exists (select 1 from %I p where p.id = %I.%I and app_has_permission(p.organization_id, %L)))',
      r.t || '_write', r.t, r.parent, r.t, r.fk, 'insurance.claims',
      r.parent, r.t, r.fk, 'insurance.claims');
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_active_preauthorization','app_set_preauth_status',
                         'app_active_insurance_contract','app_insurance_coverage',
                         'app_resolve_item_price_v2','app_claim_status_allowed',
                         'app_set_claim_form_status','app_resubmit_claim_form')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 10) إصلاح فحص الأهلية — الثقب الأصلي
-- ===========================================================================
--
-- الدالة القديمة تقبل أيّ موافقة معتمدة للمريض خلال ٩٠ يومًا مهما كانت
-- الخدمة. تُستبدل الكتلة كلها بنداء `app_active_preauthorization` الذي يطابق
-- الصنف ونافذة السريان.
create or replace function app_check_service_eligibility(
  p_item_id uuid, p_patient_id uuid, p_branch_id uuid default null,
  p_stage text default 'execution'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item     items%rowtype;
  v_patient  patients%rowtype;
  v_age      integer;
  v_blocks   text[] := '{}';
  v_warnings text[] := '{}';
  v_preauth  insurance_preauthorizations%rowtype;
begin
  if p_stage not in ('booking','execution') then
    raise exception 'مرحلة غير معروفة: %', p_stage;
  end if;

  select * into v_item from items where id = p_item_id;
  if v_item.id is null then raise exception 'الخدمة غير موجودة'; end if;
  if not app_is_member(v_item.organization_id) then raise exception 'لا صلاحية'; end if;

  select * into v_patient from patients
   where id = p_patient_id and organization_id = v_item.organization_id;
  if v_patient.id is null then raise exception 'المريض غير موجود في هذه المنشأة'; end if;

  if v_item.is_archived then
    v_blocks := array_append(v_blocks, 'الخدمة مؤرشفة');
  elsif v_item.is_disabled then
    v_blocks := array_append(v_blocks, 'الخدمة معطَّلة');
  end if;

  if p_branch_id is not null and not app_item_available_in_branch(p_item_id, p_branch_id) then
    v_blocks := array_append(v_blocks, 'الخدمة غير متاحة في هذا الفرع');
  end if;

  if v_patient.birth_date is not null then
    v_age := extract(year from age(current_date, v_patient.birth_date))::int;
    if v_item.min_age_years is not null and v_age < v_item.min_age_years then
      v_blocks := array_append(v_blocks,
        format('الخدمة لعمر %s سنة فأكثر، وعمر المريض %s', v_item.min_age_years, v_age));
    end if;
    if v_item.max_age_years is not null and v_age > v_item.max_age_years then
      v_blocks := array_append(v_blocks,
        format('الخدمة لعمر %s سنة فأقل، وعمر المريض %s', v_item.max_age_years, v_age));
    end if;
  elsif v_item.min_age_years is not null or v_item.max_age_years is not null then
    v_warnings := array_append(v_warnings, 'الخدمة مقيّدة بالعمر وتاريخ ميلاد المريض غير مسجَّل');
  end if;

  if v_item.gender_restriction <> 'any' then
    if v_patient.gender is null then
      v_warnings := array_append(v_warnings, 'الخدمة مقيّدة بالجنس وجنس المريض غير مسجَّل');
    elsif v_patient.gender <> v_item.gender_restriction then
      v_blocks := array_append(v_blocks,
        case v_item.gender_restriction when 'male' then 'الخدمة للذكور فقط'
                                       else 'الخدمة للإناث فقط' end);
    end if;
  end if;

  if v_item.requires_fasting then
    v_warnings := array_append(v_warnings,
      coalesce('صيام ' || v_item.fasting_hours || ' ساعة قبل الخدمة', 'الخدمة تتطلّب صيامًا'));
  end if;
  if v_item.preparation_ar is not null and btrim(v_item.preparation_ar) <> '' then
    v_warnings := array_append(v_warnings, 'تحضير مطلوب: ' || v_item.preparation_ar);
  end if;
  if v_item.requires_consent then
    v_warnings := array_append(v_warnings, 'تتطلّب موافقة موقَّعة من المريض');
  end if;
  if v_item.requires_referral then
    v_warnings := array_append(v_warnings, 'تتطلّب إحالة من طبيب');
  end if;

  if v_item.requires_preauthorization then
    v_preauth := app_active_preauthorization(p_patient_id, p_item_id, current_date);
    if v_preauth.id is null then
      if p_stage = 'booking' then
        v_warnings := array_append(v_warnings,
          'تتطلّب موافقة تأمين مسبقة لهذه الخدمة — اطلبها قبل موعد التنفيذ');
      else
        v_blocks := array_append(v_blocks,
          'تتطلّب موافقة تأمين مسبقة لهذه الخدمة، ولا توجد موافقة سارية');
      end if;
    elsif v_preauth.valid_to is not null and v_preauth.valid_to <= current_date + 7 then
      v_warnings := array_append(v_warnings,
        format('الموافقة المسبقة تنتهي بتاريخ %s', v_preauth.valid_to));
    end if;
  end if;

  if exists (
    select 1 from item_resources ir
     where ir.item_id = p_item_id and ir.is_required
       and not exists (
         select 1 from resources r
          where r.id = ir.resource_id and r.is_active
            and (p_branch_id is null or r.branch_id is null or r.branch_id = p_branch_id)
       )
  ) then
    v_blocks := array_append(v_blocks, 'مورد مطلوب للخدمة غير متاح في هذا الفرع');
  end if;

  return jsonb_build_object(
    'ok', cardinality(v_blocks) = 0,
    'blocks', to_jsonb(v_blocks),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

-- ===========================================================================
-- 11) المناظير
-- ===========================================================================

create or replace view v_insurance_contracts
with (security_invoker = on) as
select
  c.id, c.organization_id, c.company_id, co.name_ar as company_name,
  c.network_id, n.name_ar as network_name,
  c.contract_number, c.name_ar, c.name_en,
  c.price_list_id, pl.name as price_list_name,
  c.discount_percent, c.default_copay_percent, c.payment_terms_days,
  c.claim_submission_days, c.effective_from, c.effective_to, c.status,
  (c.status = 'active' and c.effective_from <= current_date
   and (c.effective_to is null or c.effective_to >= current_date))  as is_in_effect,
  case when c.effective_to is null then null
       else c.effective_to - current_date end                        as days_to_expiry,
  (select count(*) from insurance_coverage_rules r
    where r.contract_id = c.id and r.is_active)                      as coverage_rules_count,
  c.notes, c.created_at
from insurance_contracts c
join insurance_companies co on co.id = c.company_id
left join insurance_networks n on n.id = c.network_id
left join price_lists pl on pl.id = c.price_list_id;

create or replace view v_claim_register
with (security_invoker = on) as
select
  f.id as form_id, f.organization_id, f.form_type, f.status,
  f.created_at, f.submitted_at, f.responded_at, f.paid_at,
  f.claimed_amount, f.approved_amount, f.rejected_amount,
  f.rejection_code, f.rejection_reason,
  f.resubmission_of_id, f.resubmission_count,
  f.nphies_request_id, f.nphies_status,
  p.id as patient_id, p.name_ar as patient_name, p.file_number,
  d.name_ar as doctor_name,
  cl.name   as clinic_name,
  co.id     as company_id, co.name_ar as company_name,
  pol.policy_name, m.membership_number,
  f.sales_invoice_id, inv.invoice_number, inv.net_amount as invoice_amount,
  f.batch_id, b.batch_number, b.status as batch_status,
  case when f.status = 'rejected' and f.resubmission_count = 0 then true else false end
    as needs_resubmission,
  case when f.status in ('draft','submitted')
        and f.created_at < now() - interval '30 days' then true else false end
    as is_stale
from insurance_claim_forms f
join patients p on p.id = f.patient_id
left join doctors d on d.id = f.doctor_id
left join clinics cl on cl.id = f.clinic_id
left join patient_insurance_memberships m on m.id = f.membership_id
left join insurance_policies pol on pol.id = m.policy_id
left join insurance_companies co on co.id = pol.company_id
left join sales_invoices inv on inv.id = f.sales_invoice_id
left join insurance_claim_batches b on b.id = f.batch_id;

comment on view v_claim_register is
  'سجل المطالبات: ما قُدِّم، وما رُدَّ ولماذا، وما يحتاج إعادة تقديم، وما ركد أكثر من ثلاثين يومًا.';

create or replace view v_patient_insurance_status
with (security_invoker = on) as
select
  u.membership_id, u.organization_id, u.patient_id, u.policy_id, u.company_id,
  co.name_ar   as company_name,
  pol.policy_name, pol.policy_number,
  n.name_ar    as network_name,
  cls.name_ar  as class_name,
  m.membership_number, m.relation, m.expiry_date, m.eligibility_status, m.is_active,
  u.annual_limit, u.used_amount, u.remaining_amount, u.copay_percent,
  u.default_consultation_limit,
  ct.id        as contract_id,
  ct.name_ar   as contract_name,
  (ct.id is not null) as has_active_contract,
  case
    when not m.is_active                                  then 'العضوية غير نشطة'
    when m.expiry_date is not null and m.expiry_date < current_date then 'العضوية منتهية'
    when m.eligibility_status = 'not_eligible'            then 'غير مؤهَّل'
    when u.remaining_amount is not null and u.remaining_amount <= 0 then 'استُهلك السقف السنوي'
    when ct.id is null                                    then 'لا عقد ساري مع الشركة'
    else null
  end as issue
from v_membership_limit_usage u
join patient_insurance_memberships m on m.id = u.membership_id
join insurance_policies pol on pol.id = u.policy_id
join insurance_companies co on co.id = u.company_id
left join insurance_networks n on n.id = pol.network_id
left join lookup_values cls on cls.id = pol.class_value_id
left join lateral (
  select c.* from insurance_contracts c
   where c.organization_id = u.organization_id and c.company_id = u.company_id
     and c.status = 'active' and c.effective_from <= current_date
     and (c.effective_to is null or c.effective_to >= current_date)
   order by c.effective_from desc limit 1
) ct on true;

grant select on v_insurance_contracts, v_claim_register, v_patient_insurance_status,
                v_membership_limit_usage to authenticated;

-- الجداول الجديدة تحتاج منحًا صريحًا: 0078 منحت ما كان موجودًا يومها، وما
-- يُنشأ بعدها لا يرثه — فيصير الجدول محميًّا بـ«permission denied» لا بـRLS،
-- ورسالةٌ كهذه تُقرأ كعطل لا كمنع.
grant select, insert, update on insurance_networks, insurance_contracts, insurance_coverage_rules to authenticated;

-- ===========================================================================
-- 12) فحص ذاتي
-- ===========================================================================
do $$
declare
  v_bad text;
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'app_check_service_eligibility'
                and pg_get_functiondef(p.oid) like '%interval ''90 days''%') then
    raise exception 'فحص الأهلية ما زال يقبل أيّ موافقة خلال ٩٠ يومًا — الثقب مفتوح';
  end if;

  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where tablename in ('insurance_companies','insurance_policies','insurance_contracts',
                       'insurance_coverage_rules','insurance_preauthorizations',
                       'insurance_claim_forms','insurance_claim_batches',
                       'patient_insurance_memberships','insurance_networks')
     and cmd in ('ALL','DELETE');
  if v_bad is not null then
    raise exception 'بقيت سياسة واسعة على جداول التأمين: %', v_bad;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'insurance_contracts_no_overlap') then
    raise exception 'منع تداخل العقود غير مركَّب';
  end if;
end $$;
