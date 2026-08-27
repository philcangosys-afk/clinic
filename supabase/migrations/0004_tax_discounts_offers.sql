-- ============================================================================
-- 0004_tax_discounts_offers.sql
-- المرحلة 2 (تابع) — الضريبة والخصومات والعروض + إعدادات كشفية المريض
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 و0002 و0003 مباشرة (يعتمد عليها)
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- يغطي هذا الملف:
--   1) ضبط الخصم العام على مستوى المؤسسة (لقطة 88، المستوى 2 من ترتيب الخصومات)
--   2) العروض والخصومات الزمنية (لقطة 11، المستوى 3 من ترتيب الخصومات)
--   3) دالة resolve_vat_rate — منطق ضريبة القيمة المضافة متعدد المستويات (لقطة 8)
--   4) دالة resolve_discount — ترتيب أولوية الخصومات المُعتمد حرفيًا من النظام القديم
--      (لقطة 88): خصم المريض الافتراضي ← الخصم العام ← العروض الزمنية ← خصم الصنف
--   5) دالة التحقق من التزام الخصم بحدود discount_limits (من 0001)
--   6) إعدادات كشفية المريض (لقطة 9): تجديد دوري، مراجعات مجانية، استثناء تخصصات
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) الخصم العام على مستوى المؤسسة (لقطة 7/88 — منفصل عن discount_limits التي
--    تحدد "الحد الأقصى المسموح به" لكل صفة/مستخدم، هذا هو "قيمة" الخصم الافتراضي)
-- ---------------------------------------------------------------------------
create table if not exists organization_discount_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  general_discount_percent numeric(5,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) العروض والخصومات الزمنية (لقطة 11)
-- ---------------------------------------------------------------------------
create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  offer_number bigserial,
  classification text,                 -- التصنيف (مثال: عرض التبييض، عرض الصيف)
  title text not null,
  description text,
  offer_scope text not null default 'date_range' check (offer_scope in ('open_date','date_range')),
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  discount_percent numeric(5,2) not null default 0,
  applies_to_all_items boolean not null default true,
  is_disabled boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, offer_number)
);
create index if not exists idx_offers_org_active on offers (organization_id, is_disabled);

-- استهداف عروض محددة بأصناف/فئات (يُستخدم فقط عندما applies_to_all_items = false)
create table if not exists offer_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers(id) on delete cascade,
  item_id uuid references items(id) on delete cascade,
  category_value_id uuid references lookup_values(id) on delete cascade,
  check (item_id is not null or category_value_id is not null)
);
create index if not exists idx_offer_items_offer on offer_items (offer_id);

-- ---------------------------------------------------------------------------
-- 3) إعدادات كشفية المريض (لقطة 9)
-- ---------------------------------------------------------------------------
create table if not exists consultation_fee_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  renewal_alert_enabled boolean not null default true,
  exempt_specialty_value_ids uuid[] not null default '{}',   -- تخصصات مستثناة من التحقق قبل إرسال الملف للطبيب (الأشعة/المختبر/الصيدلية)
  updated_at timestamptz not null default now()
);

create table if not exists consultation_fee_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  specialty_value_id uuid references lookup_values(id) on delete set null,   -- null = كل التخصصات (قاعدة عامة)
  is_insurance_specific boolean not null default false,                      -- وضع خاص لأكواد كشفية مرضى التأمين
  insurance_company_name text,
  consultation_item_id uuid references items(id) on delete set null,
  follow_up_item_id uuid references items(id) on delete set null,
  renewal_days int not null default 30,
  free_reviews_count int not null default 0,
  doctor_ids uuid[] not null default '{}',        -- تخصيص القاعدة لأطباء معينين، فارغة = كل الأطباء
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_consultation_rules_org on consultation_fee_rules (organization_id);

-- ============================================================================
-- الدوال (Functions)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- resolve_vat_rate: يحل نسبة الضريبة الفعلية لصنف/مريض معينين، بالترتيب:
--   إعفاء الصنف نفسه (إن لم يُعطَّل) → إعفاء جنسية المريض (إن لم يُعطَّل)
--   → نسبة الصنف المخصصة → نسبة فئة الصنف → النسبة الافتراضية للمؤسسة
-- يُعيد صفًا واحدًا (vat_rate, is_exempt) بدل رقم فقط، لأن الإعفاء (Exempt) في
-- ZATCA يختلف قانونيًا عن "صنف بنسبة صفر" رغم تطابق الأثر الحسابي المباشر.
-- ---------------------------------------------------------------------------
create or replace function app_resolve_vat_rate(
  p_organization_id uuid,
  p_item_id uuid,
  p_patient_id uuid default null
)
returns table (vat_rate numeric, is_exempt boolean)
language plpgsql
stable
security definer
as $$
declare
  v_org organizations%rowtype;
  v_settings organization_vat_settings%rowtype;
  v_item items%rowtype;
  v_category_vat numeric;
  v_patient_nationality uuid;
  v_exempt boolean := false;
  v_rate numeric;
begin
  select * into v_org from organizations where id = p_organization_id;
  select * into v_settings from organization_vat_settings where organization_id = p_organization_id;
  select * into v_item from items where id = p_item_id;

  if v_item.is_vat_exempt and not coalesce(v_settings.vat_exemption_disabled_for_items, false) then
    v_exempt := true;
  end if;

  if not v_exempt and p_patient_id is not null then
    select nationality_value_id into v_patient_nationality from patients where id = p_patient_id;
    if v_patient_nationality is not null
       and v_settings.vat_exempt_nationality_value_ids is not null
       and v_patient_nationality = any (v_settings.vat_exempt_nationality_value_ids)
       and not coalesce(v_settings.vat_exemption_disabled_for_customer_types, false)
    then
      v_exempt := true;
    end if;
  end if;

  if v_exempt then
    return query select 0::numeric, true;
    return;
  end if;

  if v_item.category_value_id is not null then
    select (lv.extra ->> 'default_vat_rate')::numeric into v_category_vat
    from lookup_values lv
    where lv.id = v_item.category_value_id;
  end if;

  v_rate := coalesce(v_item.vat_rate_override, v_category_vat, v_org.default_vat_rate, 0);
  return query select v_rate, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_discount: يحل نسبة الخصم الفعلية لمريض/صنف/تاريخ معينين، بالترتيب
-- الحرفي المُعلَن في النظام القديم (لقطة 88):
--   1) الخصم الافتراضي المسجَّل في ملف المريض
--   2) ضبط الخصم العام على مستوى المؤسسة
--   3) العروض والخصومات (الحملات الزمنية) — يُؤخذ أعلى عرض ساري ومطابق للصنف
--   4) الخصم المسجَّل في بطاقة الصنف نفسه
-- يتوقف عند أول قيمة أكبر من صفر (مطابقةً حرفية لسلوك النظام القديم الموثّق).
-- ---------------------------------------------------------------------------
create or replace function app_resolve_discount(
  p_organization_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_as_of date default current_date
)
returns numeric
language plpgsql
stable
security definer
as $$
declare
  v_patient_discount numeric;
  v_general_discount numeric;
  v_offer_discount numeric;
  v_item_category uuid;
  v_item_discount numeric;
begin
  if p_patient_id is not null then
    select default_discount_percent into v_patient_discount from patients where id = p_patient_id;
    if v_patient_discount is not null and v_patient_discount > 0 then
      return v_patient_discount;
    end if;
  end if;

  select general_discount_percent into v_general_discount
    from organization_discount_settings where organization_id = p_organization_id;
  if v_general_discount is not null and v_general_discount > 0 then
    return v_general_discount;
  end if;

  select category_value_id into v_item_category from items where id = p_item_id;

  select max(o.discount_percent) into v_offer_discount
  from offers o
  where o.organization_id = p_organization_id
    and o.is_disabled = false
    and (
      o.offer_scope = 'open_date'
      or (
        (o.start_date is null or p_as_of >= o.start_date)
        and (o.end_date is null or p_as_of <= o.end_date)
      )
    )
    and (
      o.applies_to_all_items
      or exists (
        select 1 from offer_items oi
        where oi.offer_id = o.id
          and (oi.item_id = p_item_id or (v_item_category is not null and oi.category_value_id = v_item_category))
      )
    );

  if v_offer_discount is not null and v_offer_discount > 0 then
    return v_offer_discount;
  end if;

  select default_discount_percent into v_item_discount from items where id = p_item_id;
  return coalesce(v_item_discount, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- app_discount_within_limits: يتحقق أن نسبة خصم معينة ضمن الحد المسموح لهذا
-- المستخدم أو صفته (جدول discount_limits من 0001) — عدم وجود حد مُعرَّف يعني
-- عدم وجود قيود (مطابق لسلوك النظام القديم حين تُترك الحدود فارغة)
-- ---------------------------------------------------------------------------
create or replace function app_discount_within_limits(
  p_organization_id uuid,
  p_user_id uuid,
  p_percent numeric
)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  v_role text;
  v_ok boolean;
begin
  select role_key into v_role from organization_memberships
    where organization_id = p_organization_id and user_id = p_user_id and is_active = true;

  select bool_or(p_percent >= dl.min_percent and p_percent <= dl.max_percent) into v_ok
  from discount_limits dl
  where dl.organization_id = p_organization_id
    and (dl.applies_to_user_id = p_user_id or (v_role is not null and dl.applies_to_role = v_role));

  if v_ok is null then
    return true;   -- لا يوجد حد مُعرَّف لهذا المستخدم/الصفة = غير مقيّد
  end if;
  return v_ok;
end;
$$;

-- ---------------------------------------------------------------------------
-- كشفية المريض: تاريخ آخر كشفية + هل حان موعد التجديد
-- ---------------------------------------------------------------------------
create or replace function app_patient_last_consultation_date(
  p_patient_id uuid,
  p_specialty_value_id uuid default null
)
returns date
language sql
stable
security definer
as $$
  select max(si.created_at::date)
  from sales_invoices si
  join sales_invoice_items sii on sii.invoice_id = si.id
  join consultation_fee_rules r on r.consultation_item_id = sii.item_id
  where si.patient_id = p_patient_id
    and si.invoice_type = 'sale'
    and r.is_disabled = false
    and (p_specialty_value_id is null or r.specialty_value_id = p_specialty_value_id);
$$;

create or replace function app_is_consultation_renewal_due(
  p_patient_id uuid,
  p_specialty_value_id uuid,
  p_renewal_days int default 30
)
returns boolean
language sql
stable
security definer
as $$
  select case
    when app_patient_last_consultation_date(p_patient_id, p_specialty_value_id) is null then true
    else (current_date - app_patient_last_consultation_date(p_patient_id, p_specialty_value_id)) >= p_renewal_days
  end;
$$;

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table organization_discount_settings enable row level security;
alter table offers enable row level security;
alter table offer_items enable row level security;
alter table consultation_fee_settings enable row level security;
alter table consultation_fee_rules enable row level security;

create policy "discount_settings_read_members" on organization_discount_settings
  for select using (app_is_member(organization_id));
create policy "discount_settings_insert_admins" on organization_discount_settings
  for insert with check (app_is_org_admin(organization_id));
create policy "discount_settings_update_admins" on organization_discount_settings
  for update using (app_is_org_admin(organization_id));

create policy "offers_all_members" on offers
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "offer_items_all_members" on offer_items
  for all using (exists (select 1 from offers o where o.id = offer_items.offer_id and app_is_member(o.organization_id)))
  with check (exists (select 1 from offers o where o.id = offer_items.offer_id and app_is_member(o.organization_id)));

create policy "consultation_settings_read_members" on consultation_fee_settings
  for select using (app_is_member(organization_id));
create policy "consultation_settings_insert_admins" on consultation_fee_settings
  for insert with check (app_is_org_admin(organization_id));
create policy "consultation_settings_update_admins" on consultation_fee_settings
  for update using (app_is_org_admin(organization_id));

create policy "consultation_rules_all_members" on consultation_fee_rules
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ============================================================================
-- نهاية 0004_tax_discounts_offers.sql
-- الخطوة التالية: 0005_medical_insurance.sql (UCAF/DCAF/OCAF، بوليصات ومطالبات التأمين)
-- ============================================================================
