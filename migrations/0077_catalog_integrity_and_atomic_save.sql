begin;

update items
set medical_service_type = 'laboratory'
where medical_service_type = 'lab';

update items
set medical_service_type = 'other'
where medical_service_type is not null
  and medical_service_type not in (
    'consultation','follow_up','procedure','surgery','laboratory','radiology',
    'dental','physiotherapy','vaccination','nursing','dressing','injection',
    'screening','home_visit','other'
  );

alter table items drop constraint if exists items_medical_service_type_check;
alter table items add constraint items_medical_service_type_check check (
  medical_service_type is null or medical_service_type in (
    'consultation','follow_up','procedure','surgery','laboratory','radiology',
    'dental','physiotherapy','vaccination','nursing','dressing','injection',
    'screening','home_visit','other'
  )
);

create unique index if not exists uq_branches_org_id on branches (organization_id, id);
create unique index if not exists uq_resources_org_id on resources (organization_id, id);
create unique index if not exists uq_accounts_org_id on chart_of_accounts (organization_id, id);
create unique index if not exists uq_insurance_companies_org_id on insurance_companies (organization_id, id);
create unique index if not exists uq_external_clients_org_id on external_clients (organization_id, id);
create unique index if not exists uq_price_lists_org_id on price_lists (organization_id, id);

alter table item_branches
  drop constraint if exists item_branches_item_id_fkey,
  drop constraint if exists item_branches_branch_id_fkey;
alter table item_branches
  add constraint item_branches_item_tenant_fk foreign key (organization_id, item_id)
    references items (organization_id, id) on delete cascade,
  add constraint item_branches_branch_tenant_fk foreign key (organization_id, branch_id)
    references branches (organization_id, id) on delete cascade;

alter table resources
  drop constraint if exists resources_branch_id_fkey,
  drop constraint if exists resources_clinic_id_fkey;
alter table resources
  add constraint resources_branch_tenant_fk foreign key (organization_id, branch_id)
    references branches (organization_id, id) on delete set null (branch_id),
  add constraint resources_clinic_tenant_fk foreign key (organization_id, clinic_id)
    references clinics (organization_id, id) on delete set null (clinic_id);

alter table item_resources
  drop constraint if exists item_resources_item_id_fkey,
  drop constraint if exists item_resources_resource_id_fkey;
alter table item_resources
  add constraint item_resources_item_tenant_fk foreign key (organization_id, item_id)
    references items (organization_id, id) on delete cascade,
  add constraint item_resources_resource_tenant_fk foreign key (organization_id, resource_id)
    references resources (organization_id, id) on delete cascade;

alter table item_claim_codes
  drop constraint if exists item_claim_codes_item_id_fkey,
  drop constraint if exists item_claim_codes_insurance_company_id_fkey;
alter table item_claim_codes
  add constraint item_claim_codes_item_tenant_fk foreign key (organization_id, item_id)
    references items (organization_id, id) on delete cascade,
  add constraint item_claim_codes_company_tenant_fk foreign key (organization_id, insurance_company_id)
    references insurance_companies (organization_id, id) on delete cascade;

alter table price_lists
  drop constraint if exists price_lists_branch_id_fkey,
  drop constraint if exists price_lists_insurance_company_id_fkey,
  drop constraint if exists price_lists_external_client_id_fkey;
alter table price_lists
  add constraint price_lists_branch_tenant_fk foreign key (organization_id, branch_id)
    references branches (organization_id, id) on delete cascade,
  add constraint price_lists_company_tenant_fk foreign key (organization_id, insurance_company_id)
    references insurance_companies (organization_id, id) on delete cascade,
  add constraint price_lists_client_tenant_fk foreign key (organization_id, external_client_id)
    references external_clients (organization_id, id) on delete cascade;

alter table price_list_items
  drop constraint if exists price_list_items_price_list_id_fkey,
  drop constraint if exists price_list_items_item_id_fkey;
alter table price_list_items
  add constraint price_list_items_list_tenant_fk foreign key (organization_id, price_list_id)
    references price_lists (organization_id, id) on delete cascade,
  add constraint price_list_items_item_tenant_fk foreign key (organization_id, item_id)
    references items (organization_id, id) on delete cascade;

alter table items
  drop constraint if exists items_default_clinic_id_fkey,
  drop constraint if exists items_revenue_account_id_fkey,
  drop constraint if exists items_cogs_account_id_fkey;
alter table items
  add constraint items_default_clinic_tenant_fk foreign key (organization_id, default_clinic_id)
    references clinics (organization_id, id) on delete set null (default_clinic_id),
  add constraint items_revenue_account_tenant_fk foreign key (organization_id, revenue_account_id)
    references chart_of_accounts (organization_id, id) on delete set null (revenue_account_id),
  add constraint items_cogs_account_tenant_fk foreign key (organization_id, cogs_account_id)
    references chart_of_accounts (organization_id, id) on delete set null (cogs_account_id);

create or replace function app_save_catalog_item(
  p_item jsonb,
  p_branch_ids uuid[] default '{}',
  p_resource_ids uuid[] default '{}',
  p_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := nullif(p_item ->> 'organization_id', '')::uuid;
  v_id uuid := p_item_id;
  v_code text := nullif(btrim(p_item ->> 'code'), '');
  v_name text := nullif(btrim(p_item ->> 'name_ar'), '');
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if v_org is null or not app_has_permission(v_org, 'catalog.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة الكتالوج';
  end if;
  if v_name is null then
    raise exception 'الاسم العربي مطلوب';
  end if;
  if v_code is null then
    raise exception 'كود الخدمة مطلوب';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_branch_ids, '{}')) x(id)
    where not exists (select 1 from branches b where b.id = x.id and b.organization_id = v_org)
  ) then
    raise exception 'أحد الفروع المحددة لا ينتمي لهذه المنشأة';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_resource_ids, '{}')) x(id)
    where not exists (select 1 from resources r where r.id = x.id and r.organization_id = v_org)
  ) then
    raise exception 'أحد الموارد المحددة لا ينتمي لهذه المنشأة';
  end if;

  if v_id is null then
    insert into items (
      organization_id, code, barcode, name_ar, name_en, description_ar, description_en,
      item_type, medical_service_type, category_value_id, default_clinic_id,
      duration_minutes, provider_role, requires_appointment, price, cost_price,
      default_discount_percent, is_vat_exempt, is_disabled, requires_fasting,
      fasting_hours, preparation_ar, preparation_en, contraindications_ar,
      min_age_years, max_age_years, gender_restriction, requires_consent,
      consent_note_ar, requires_preauthorization, requires_referral,
      preauthorization_note, revenue_account_id, cogs_account_id
    ) values (
      v_org, v_code, nullif(btrim(p_item ->> 'barcode'), ''), v_name,
      nullif(btrim(p_item ->> 'name_en'), ''), nullif(btrim(p_item ->> 'description_ar'), ''),
      nullif(btrim(p_item ->> 'description_en'), ''), coalesce(p_item ->> 'item_type', 'service'),
      nullif(p_item ->> 'medical_service_type', ''), nullif(p_item ->> 'category_value_id', '')::uuid,
      nullif(p_item ->> 'default_clinic_id', '')::uuid, nullif(p_item ->> 'duration_minutes', '')::integer,
      coalesce(nullif(p_item ->> 'provider_role', ''), 'any'), coalesce((p_item ->> 'requires_appointment')::boolean, false),
      coalesce((p_item ->> 'price')::numeric, 0), coalesce((p_item ->> 'cost_price')::numeric, 0),
      coalesce((p_item ->> 'default_discount_percent')::numeric, 0), coalesce((p_item ->> 'is_vat_exempt')::boolean, false),
      coalesce((p_item ->> 'is_disabled')::boolean, false), coalesce((p_item ->> 'requires_fasting')::boolean, false),
      nullif(p_item ->> 'fasting_hours', '')::integer, nullif(btrim(p_item ->> 'preparation_ar'), ''),
      nullif(btrim(p_item ->> 'preparation_en'), ''), nullif(btrim(p_item ->> 'contraindications_ar'), ''),
      nullif(p_item ->> 'min_age_years', '')::integer, nullif(p_item ->> 'max_age_years', '')::integer,
      coalesce(nullif(p_item ->> 'gender_restriction', ''), 'any'), coalesce((p_item ->> 'requires_consent')::boolean, false),
      nullif(btrim(p_item ->> 'consent_note_ar'), ''), coalesce((p_item ->> 'requires_preauthorization')::boolean, false),
      coalesce((p_item ->> 'requires_referral')::boolean, false), nullif(btrim(p_item ->> 'preauthorization_note'), ''),
      nullif(p_item ->> 'revenue_account_id', '')::uuid, nullif(p_item ->> 'cogs_account_id', '')::uuid
    ) returning id into v_id;
  else
    perform 1 from items where id = v_id and organization_id = v_org for update;
    if not found then
      raise exception 'الخدمة غير موجودة في هذه المنشأة';
    end if;

    update items set
      code = v_code,
      barcode = nullif(btrim(p_item ->> 'barcode'), ''),
      name_ar = v_name,
      name_en = nullif(btrim(p_item ->> 'name_en'), ''),
      description_ar = nullif(btrim(p_item ->> 'description_ar'), ''),
      description_en = nullif(btrim(p_item ->> 'description_en'), ''),
      item_type = coalesce(p_item ->> 'item_type', item_type),
      medical_service_type = nullif(p_item ->> 'medical_service_type', ''),
      category_value_id = nullif(p_item ->> 'category_value_id', '')::uuid,
      default_clinic_id = nullif(p_item ->> 'default_clinic_id', '')::uuid,
      duration_minutes = nullif(p_item ->> 'duration_minutes', '')::integer,
      provider_role = coalesce(nullif(p_item ->> 'provider_role', ''), 'any'),
      requires_appointment = coalesce((p_item ->> 'requires_appointment')::boolean, false),
      price = coalesce((p_item ->> 'price')::numeric, 0),
      cost_price = coalesce((p_item ->> 'cost_price')::numeric, 0),
      default_discount_percent = coalesce((p_item ->> 'default_discount_percent')::numeric, 0),
      is_vat_exempt = coalesce((p_item ->> 'is_vat_exempt')::boolean, false),
      is_disabled = coalesce((p_item ->> 'is_disabled')::boolean, false),
      requires_fasting = coalesce((p_item ->> 'requires_fasting')::boolean, false),
      fasting_hours = nullif(p_item ->> 'fasting_hours', '')::integer,
      preparation_ar = nullif(btrim(p_item ->> 'preparation_ar'), ''),
      preparation_en = nullif(btrim(p_item ->> 'preparation_en'), ''),
      contraindications_ar = nullif(btrim(p_item ->> 'contraindications_ar'), ''),
      min_age_years = nullif(p_item ->> 'min_age_years', '')::integer,
      max_age_years = nullif(p_item ->> 'max_age_years', '')::integer,
      gender_restriction = coalesce(nullif(p_item ->> 'gender_restriction', ''), 'any'),
      requires_consent = coalesce((p_item ->> 'requires_consent')::boolean, false),
      consent_note_ar = nullif(btrim(p_item ->> 'consent_note_ar'), ''),
      requires_preauthorization = coalesce((p_item ->> 'requires_preauthorization')::boolean, false),
      requires_referral = coalesce((p_item ->> 'requires_referral')::boolean, false),
      preauthorization_note = nullif(btrim(p_item ->> 'preauthorization_note'), ''),
      revenue_account_id = nullif(p_item ->> 'revenue_account_id', '')::uuid,
      cogs_account_id = nullif(p_item ->> 'cogs_account_id', '')::uuid,
      updated_at = now()
    where id = v_id and organization_id = v_org;
  end if;

  delete from item_branches where item_id = v_id and organization_id = v_org;
  insert into item_branches (organization_id, item_id, branch_id)
  select v_org, v_id, x.id from unnest(coalesce(p_branch_ids, '{}')) x(id)
  on conflict do nothing;

  delete from item_resources where item_id = v_id and organization_id = v_org;
  insert into item_resources (organization_id, item_id, resource_id, is_required)
  select v_org, v_id, x.id, true from unnest(coalesce(p_resource_ids, '{}')) x(id)
  on conflict (item_id, resource_id) do nothing;

  return v_id;
end;
$$;

revoke all on function app_save_catalog_item(jsonb, uuid[], uuid[], uuid) from public, anon;
grant execute on function app_save_catalog_item(jsonb, uuid[], uuid[], uuid) to authenticated;

create or replace function app_set_price_list_item(
  p_price_list_id uuid,
  p_item_id uuid,
  p_price numeric,
  p_effective_from date default current_date,
  p_discount_percent numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_list price_lists%rowtype;
  v_id uuid;
  v_current price_list_items%rowtype;
begin
  select * into v_list from price_lists where id = p_price_list_id for update;
  if v_list.id is null then raise exception 'قائمة الأسعار غير موجودة'; end if;
  if not app_has_permission(v_list.organization_id, 'catalog.pricing') then
    raise exception 'صلاحيتك لا تسمح بتعديل الأسعار';
  end if;
  if not v_list.is_active then raise exception 'قائمة الأسعار معطَّلة'; end if;
  if not exists (select 1 from items where id = p_item_id and organization_id = v_list.organization_id) then
    raise exception 'الصنف لا ينتمي لهذه المنشأة';
  end if;
  if p_price < 0 then raise exception 'السعر لا يكون سالبًا'; end if;
  if p_discount_percent is null or p_discount_percent < 0 or p_discount_percent > 100 then
    raise exception 'نسبة الخصم يجب أن تكون بين 0 و100';
  end if;
  if p_effective_from < v_list.effective_from
     or (v_list.effective_to is not null and p_effective_from > v_list.effective_to) then
    raise exception 'تاريخ السعر خارج فترة سريان القائمة';
  end if;

  select * into v_current from price_list_items
   where price_list_id = p_price_list_id and item_id = p_item_id and effective_to is null
   for update;
  if v_current.id is not null then
    if p_effective_from <= v_current.effective_from then
      raise exception 'تاريخ السريان الجديد يجب أن يكون بعد تاريخ السعر الحالي';
    end if;
    if v_current.price = p_price and v_current.discount_percent = p_discount_percent then
      raise exception 'السعر لم يتغيّر';
    end if;
    update price_list_items set effective_to = p_effective_from - 1 where id = v_current.id;
  end if;

  insert into price_list_items (
    organization_id, price_list_id, item_id, price, discount_percent, effective_from, created_by
  ) values (
    v_list.organization_id, p_price_list_id, p_item_id, p_price, p_discount_percent, p_effective_from, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function app_set_price_list_item(uuid, uuid, numeric, date, numeric) from public, anon;
grant execute on function app_set_price_list_item(uuid, uuid, numeric, date, numeric) to authenticated;

create or replace function app_appointment_service_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_check jsonb;
  v_blocks text;
  v_item items%rowtype;
  v_clinic_branch uuid;
begin
  if new.item_id is null then return new; end if;

  select * into v_item from items where id = new.item_id;
  if v_item.id is null or v_item.organization_id <> new.organization_id then
    raise exception 'الخدمة لا تنتمي لهذه المنشأة';
  end if;
  if not exists (select 1 from patients p where p.id = new.patient_id and p.organization_id = new.organization_id) then
    raise exception 'المريض لا ينتمي لهذه المنشأة';
  end if;

  if new.clinic_id is null then new.clinic_id := v_item.default_clinic_id; end if;
  if new.clinic_id is not null then
    select c.branch_id into v_clinic_branch from clinics c
     where c.id = new.clinic_id and c.organization_id = new.organization_id;
    if not found then raise exception 'العيادة لا تنتمي لهذه المنشأة'; end if;
    if v_clinic_branch is not null then new.branch_id := v_clinic_branch; end if;
  elsif new.branch_id is not null and not exists (
    select 1 from branches b where b.id = new.branch_id and b.organization_id = new.organization_id
  ) then
    raise exception 'الفرع لا ينتمي لهذه المنشأة';
  end if;

  if new.status in ('walk_in','waiting') then return new; end if;

  v_check := app_check_service_eligibility(new.item_id, new.patient_id, new.branch_id, 'booking');
  if not (v_check ->> 'ok')::boolean then
    select string_agg(value, ' — ') into v_blocks from jsonb_array_elements_text(v_check -> 'blocks');
    raise exception 'لا يمكن حجز «%» لهذا المريض: %', v_item.name_ar, v_blocks;
  end if;
  return new;
end;
$$;

revoke all on function app_appointment_service_guard() from public, anon, authenticated;
drop trigger if exists trg_appointment_service_guard on appointments;
create trigger trg_appointment_service_guard
before insert or update of item_id, organization_id, patient_id, branch_id, clinic_id, status
on appointments for each row execute function app_appointment_service_guard();

drop view if exists v_service_catalog;
create view v_service_catalog as
select
  i.id, i.organization_id, i.code, i.barcode, i.name_ar, i.name_en,
  i.description_ar, i.description_en, i.item_type, i.medical_service_type,
  i.category_value_id, cat.name_ar as category_name, i.default_clinic_id,
  c.name as clinic_name, i.duration_minutes, i.provider_role,
  i.requires_appointment, i.price, i.cost_price, i.default_discount_percent,
  i.is_vat_exempt, i.revenue_account_id, i.cogs_account_id, i.is_disabled,
  i.is_archived, i.archive_reason, i.archived_at, i.requires_fasting,
  i.fasting_hours, i.preparation_ar, i.min_age_years, i.max_age_years,
  i.gender_restriction, i.requires_consent, i.requires_preauthorization,
  i.requires_referral, coalesce(b.branch_ids, '{}') as branch_ids,
  coalesce(r.resource_ids, '{}') as resource_ids, cc.code as primary_claim_code,
  cc.code_system as primary_claim_code_system, i.created_at, i.updated_at
from items i
left join clinics c on c.id = i.default_clinic_id and c.organization_id = i.organization_id
left join lookup_values cat on cat.id = i.category_value_id
left join lateral (
  select array_agg(ib.branch_id) as branch_ids from item_branches ib
   where ib.item_id = i.id and ib.organization_id = i.organization_id
) b on true
left join lateral (
  select array_agg(ir.resource_id) as resource_ids from item_resources ir
   where ir.item_id = i.id and ir.organization_id = i.organization_id
) r on true
left join lateral (
  select x.code, x.code_system from item_claim_codes x
   where x.item_id = i.id and x.organization_id = i.organization_id
     and x.insurance_company_id is null and x.is_primary
   order by x.created_at limit 1
) cc on true;

alter view v_service_catalog set (security_invoker = on);
revoke all on v_service_catalog from anon;
grant select on v_service_catalog to authenticated;

commit;
