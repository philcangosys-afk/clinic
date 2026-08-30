-- 0077_catalog_integrity_and_atomic_save.sql
-- تكامل الكتالوج عبر المنشآت، وحفظ الخدمة في معاملة واحدة.
--
-- مشكلتان قائمتان:
--
--   1) **عزل المنشآت في جداول الكتالوج مبنيّ على عمود لا يحرسه شيء.**
--      `item_branches` تحمل `organization_id` و`item_id` و`branch_id`، ولا
--      قيد يمنع أن يكون الصنف من منشأة والفرع من أخرى. سياسات RLS تفحص
--      `organization_id` وحده، فصفٌّ مغلوط يمرّ ويبقى. المشروع يستعمل منذ
--      البداية قيودًا مركّبة `(organization_id, id)` لهذا الغرض — لم أطبّقها
--      على ما أضفتُه، وهذا الملف يصحّحه.
--
--   2) **حفظ الخدمة من الشاشة يقع في خمسة طلبات.** تعديل الصنف، ثم حذف
--      فروعه، ثم إدراجها، ثم حذف موارده، ثم إدراجها. فشلُ أيّ خطوة بعد
--      الأولى يترك الخدمة بفروع محذوفة وموارد قديمة — حالة لا يصل إليها
--      المستخدم بأي طريق مشروع. `app_save_service` تجعلها معاملة واحدة.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) مفاتيح `(organization_id, id)` اللازمة للقيود المركّبة
--
-- موجودة أصلًا على `items` و`clinics` و`patients` و`doctors`؛ ناقصة على ما
-- تشير إليه جداول الكتالوج.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['branches','resources','price_lists','insurance_companies',
                           'external_clients','packages']
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = t::regclass
         and c.contype in ('u','p')
         and c.conkey = array[
           (select attnum from pg_attribute where attrelid = t::regclass and attname = 'organization_id'),
           (select attnum from pg_attribute where attrelid = t::regclass and attname = 'id')]::smallint[]
    ) then
      execute format('alter table %I add constraint %I unique (organization_id, id)',
                     t, t || '_organization_id_id_key');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) القيود المركّبة على جداول الكتالوج
--
-- `not valid` تتبع عُرف المشروع: القيد يسري على كل صفّ جديد فورًا، ويُترك
-- التحقّق من الصفوف القديمة لخطوة `validate` منفصلة كي لا تقفل الهجرة
-- الجداول الكبيرة. الأمر الجاهز في نهاية الملف.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('item_branches',    'item_branches_item_tenant_fk',      'item_id',              'items'),
      ('item_branches',    'item_branches_branch_tenant_fk',    'branch_id',            'branches'),
      ('item_resources',   'item_resources_item_tenant_fk',     'item_id',              'items'),
      ('item_resources',   'item_resources_resource_tenant_fk', 'resource_id',          'resources'),
      ('item_claim_codes', 'item_claim_codes_item_tenant_fk',   'item_id',              'items'),
      ('item_claim_codes', 'item_claim_codes_company_tenant_fk','insurance_company_id', 'insurance_companies'),
      ('resources',        'resources_branch_tenant_fk',        'branch_id',            'branches'),
      ('resources',        'resources_clinic_tenant_fk',        'clinic_id',            'clinics'),
      ('price_lists',      'price_lists_branch_tenant_fk',      'branch_id',            'branches'),
      ('price_lists',      'price_lists_company_tenant_fk',     'insurance_company_id', 'insurance_companies'),
      ('price_lists',      'price_lists_client_tenant_fk',      'external_client_id',   'external_clients'),
      ('price_list_items', 'price_list_items_item_tenant_fk',   'item_id',              'items'),
      ('price_list_items', 'price_list_items_list_tenant_fk',   'price_list_id',        'price_lists')
    ) as v(tbl, conname, col, ref)
  loop
    if not exists (select 1 from pg_constraint where conname = r.conname) then
      execute format(
        'alter table %I add constraint %I foreign key (organization_id, %I) references %I (organization_id, id) not valid',
        r.tbl, r.conname, r.col, r.ref);
    end if;
  end loop;
end $$;

-- الخدمة على الموعد (0074) تحتاج القيد نفسه.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_item_tenant_fk') then
    alter table appointments add constraint appointments_item_tenant_fk
      foreign key (organization_id, item_id) references items (organization_id, id) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) `organization_id` على `patient_visit_services` يجب أن يطابق الزيارة
--
-- العمود موجود ويُملأ من الشاشة. لا شيء يمنع تمرير منشأة أخرى فيه، فيصير
-- الصفّ مرئيًا لمنشأة ومربوطًا بزيارة منشأة ثانية.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pvs_visit_tenant_fk') then
    alter table patient_visit_services add constraint pvs_visit_tenant_fk
      foreign key (organization_id, visit_id) references patient_visits (organization_id, id) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) حفظ الخدمة في معاملة واحدة
--
-- تُعيد معرّف الخدمة. الفروع والموارد **استبدال كامل** لا إضافة: المجموعة
-- الممرَّرة هي المقصودة، ومرور `null` يعني «لا تلمسها» — والفرق بين المصفوفة
-- الفارغة و`null` مقصود، لأن «كل الفروع» تُمثَّل بمصفوفة فارغة.
-- ---------------------------------------------------------------------------
create or replace function app_save_service(
  p_organization_id uuid,
  p_item_id         uuid,          -- null = خدمة جديدة
  p_payload         jsonb,
  p_branch_ids      uuid[] default null,
  p_resource_ids    uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_name     text;
  v_code     text;
  v_min_age  int;
  v_max_age  int;
  v_bad      uuid;
begin
  if not app_has_permission(p_organization_id, 'catalog.manage') then
    raise exception 'صلاحيتك لا تسمح بتعديل الكتالوج';
  end if;

  -- **دمج المُمرَّر فوق القائم قبل الكتابة.**
  --
  -- بدونه يكون كل مفتاح غائب عن `p_payload` مساويًا لـ null، فتحديثٌ يمرّر
  -- الاسم وحده يمحو الفرع والقسم والمدة. استدعاءٌ جزئيّ واحد يكفي لإفراغ
  -- نصف الصفّ، ولا يظهر الخطأ إلا بعد أن يفتح أحدهم الخدمة فيجدها ناقصة.
  if p_item_id is not null then
    select to_jsonb(i) || p_payload into p_payload
      from items i where i.id = p_item_id and i.organization_id = p_organization_id;
    if p_payload is null then
      raise exception 'الخدمة غير موجودة في هذه المنشأة';
    end if;
  end if;


  v_name := btrim(coalesce(p_payload ->> 'name_ar', ''));
  if v_name = '' then
    raise exception 'الاسم العربي مطلوب';
  end if;

  v_min_age := nullif(p_payload ->> 'min_age_years', '')::int;
  v_max_age := nullif(p_payload ->> 'max_age_years', '')::int;
  if v_min_age is not null and v_max_age is not null and v_min_age > v_max_age then
    raise exception 'الحدّ الأدنى للعمر أكبر من الحدّ الأقصى';
  end if;

  v_code := nullif(btrim(coalesce(p_payload ->> 'code', '')), '');
  if v_code is null then
    v_code := 'ITM-' || right(extract(epoch from clock_timestamp())::bigint::text, 6);
  end if;

  -- الفروع والموارد تُفحص قبل الكتابة لا بعدها: القيد المركّب يرفضها على كل
  -- حال، لكن رسالته بالإنجليزية ولا يفهمها المستخدم.
  if p_branch_ids is not null and array_length(p_branch_ids, 1) > 0 then
    select b into v_bad from unnest(p_branch_ids) b
     where not exists (select 1 from branches x
                        where x.id = b and x.organization_id = p_organization_id)
     limit 1;
    if v_bad is not null then
      raise exception 'فرع لا ينتمي لهذه المنشأة';
    end if;
  end if;

  if p_resource_ids is not null and array_length(p_resource_ids, 1) > 0 then
    select r into v_bad from unnest(p_resource_ids) r
     where not exists (select 1 from resources x
                        where x.id = r and x.organization_id = p_organization_id)
     limit 1;
    if v_bad is not null then
      raise exception 'مورد لا ينتمي لهذه المنشأة';
    end if;
  end if;

  if p_item_id is null then
    insert into items (
      organization_id, code, barcode, name_ar, name_en, description_ar, description_en,
      item_type, medical_service_type, category_value_id, default_clinic_id,
      duration_minutes, provider_role, requires_appointment,
      price, cost_price, default_discount_percent, is_vat_exempt, is_disabled,
      revenue_account_id, cogs_account_id,
      requires_fasting, fasting_hours, preparation_ar, preparation_en,
      contraindications_ar, min_age_years, max_age_years, gender_restriction,
      requires_consent, consent_note_ar,
      requires_preauthorization, requires_referral, preauthorization_note
    )
    values (
      p_organization_id, v_code,
      nullif(btrim(coalesce(p_payload ->> 'barcode', '')), ''),
      v_name,
      nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'description_ar', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'description_en', '')), ''),
      coalesce(p_payload ->> 'item_type', 'service'),
      nullif(p_payload ->> 'medical_service_type', ''),
      nullif(p_payload ->> 'category_value_id', '')::uuid,
      nullif(p_payload ->> 'default_clinic_id', '')::uuid,
      nullif(p_payload ->> 'duration_minutes', '')::int,
      coalesce(nullif(p_payload ->> 'provider_role', ''), 'any'),
      coalesce((p_payload ->> 'requires_appointment')::boolean, false),
      coalesce(nullif(p_payload ->> 'price', '')::numeric, 0),
      coalesce(nullif(p_payload ->> 'cost_price', '')::numeric, 0),
      coalesce(nullif(p_payload ->> 'default_discount_percent', '')::numeric, 0),
      coalesce((p_payload ->> 'is_vat_exempt')::boolean, false),
      coalesce((p_payload ->> 'is_disabled')::boolean, false),
      nullif(p_payload ->> 'revenue_account_id', '')::uuid,
      nullif(p_payload ->> 'cogs_account_id', '')::uuid,
      coalesce((p_payload ->> 'requires_fasting')::boolean, false),
      nullif(p_payload ->> 'fasting_hours', '')::int,
      nullif(btrim(coalesce(p_payload ->> 'preparation_ar', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'preparation_en', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'contraindications_ar', '')), ''),
      v_min_age, v_max_age,
      coalesce(nullif(p_payload ->> 'gender_restriction', ''), 'any'),
      coalesce((p_payload ->> 'requires_consent')::boolean, false),
      nullif(btrim(coalesce(p_payload ->> 'consent_note_ar', '')), ''),
      coalesce((p_payload ->> 'requires_preauthorization')::boolean, false),
      coalesce((p_payload ->> 'requires_referral')::boolean, false),
      nullif(btrim(coalesce(p_payload ->> 'preauthorization_note', '')), '')
    )
    returning id into v_id;
  else
    update items set
      code = v_code,
      barcode = nullif(btrim(coalesce(p_payload ->> 'barcode', '')), ''),
      name_ar = v_name,
      name_en = nullif(btrim(coalesce(p_payload ->> 'name_en', '')), ''),
      description_ar = nullif(btrim(coalesce(p_payload ->> 'description_ar', '')), ''),
      description_en = nullif(btrim(coalesce(p_payload ->> 'description_en', '')), ''),
      item_type = coalesce(p_payload ->> 'item_type', item_type),
      medical_service_type = nullif(p_payload ->> 'medical_service_type', ''),
      category_value_id = nullif(p_payload ->> 'category_value_id', '')::uuid,
      default_clinic_id = nullif(p_payload ->> 'default_clinic_id', '')::uuid,
      duration_minutes = nullif(p_payload ->> 'duration_minutes', '')::int,
      provider_role = coalesce(nullif(p_payload ->> 'provider_role', ''), 'any'),
      requires_appointment = coalesce((p_payload ->> 'requires_appointment')::boolean, false),
      price = coalesce(nullif(p_payload ->> 'price', '')::numeric, 0),
      cost_price = coalesce(nullif(p_payload ->> 'cost_price', '')::numeric, 0),
      default_discount_percent = coalesce(nullif(p_payload ->> 'default_discount_percent', '')::numeric, 0),
      is_vat_exempt = coalesce((p_payload ->> 'is_vat_exempt')::boolean, false),
      is_disabled = coalesce((p_payload ->> 'is_disabled')::boolean, false),
      revenue_account_id = nullif(p_payload ->> 'revenue_account_id', '')::uuid,
      cogs_account_id = nullif(p_payload ->> 'cogs_account_id', '')::uuid,
      requires_fasting = coalesce((p_payload ->> 'requires_fasting')::boolean, false),
      fasting_hours = nullif(p_payload ->> 'fasting_hours', '')::int,
      preparation_ar = nullif(btrim(coalesce(p_payload ->> 'preparation_ar', '')), ''),
      preparation_en = nullif(btrim(coalesce(p_payload ->> 'preparation_en', '')), ''),
      contraindications_ar = nullif(btrim(coalesce(p_payload ->> 'contraindications_ar', '')), ''),
      min_age_years = v_min_age,
      max_age_years = v_max_age,
      gender_restriction = coalesce(nullif(p_payload ->> 'gender_restriction', ''), 'any'),
      requires_consent = coalesce((p_payload ->> 'requires_consent')::boolean, false),
      consent_note_ar = nullif(btrim(coalesce(p_payload ->> 'consent_note_ar', '')), ''),
      requires_preauthorization = coalesce((p_payload ->> 'requires_preauthorization')::boolean, false),
      requires_referral = coalesce((p_payload ->> 'requires_referral')::boolean, false),
      preauthorization_note = nullif(btrim(coalesce(p_payload ->> 'preauthorization_note', '')), ''),
      updated_at = now()
    where id = p_item_id and organization_id = p_organization_id
    returning id into v_id;

    if v_id is null then
      raise exception 'الخدمة غير موجودة في هذه المنشأة';
    end if;
  end if;

  -- `null` تعني «لا تلمس»؛ المصفوفة الفارغة تعني «كل الفروع» (بحذف الصفوف).
  if p_branch_ids is not null then
    delete from item_branches where item_id = v_id;
    if array_length(p_branch_ids, 1) > 0 then
      insert into item_branches (organization_id, item_id, branch_id)
      select p_organization_id, v_id, b from unnest(p_branch_ids) b;
    end if;
  end if;

  if p_resource_ids is not null then
    delete from item_resources where item_id = v_id;
    if array_length(p_resource_ids, 1) > 0 then
      insert into item_resources (organization_id, item_id, resource_id, is_required)
      select p_organization_id, v_id, r, true from unnest(p_resource_ids) r;
    end if;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (p_organization_id, auth.uid(), 'catalog',
          case when p_item_id is null then 'add' else 'update' end,
          v_id, v_name,
          case when p_item_id is null then 'إنشاء خدمة' else 'تعديل خدمة' end);

  return v_id;
end;
$$;

revoke all on function app_save_service(uuid, uuid, jsonb, uuid[], uuid[]) from public, anon;
grant execute on function app_save_service(uuid, uuid, jsonb, uuid[], uuid[]) to authenticated;

comment on function app_save_service(uuid, uuid, jsonb, uuid[], uuid[]) is
  'حفظ خدمة مع فروعها ومواردها في معاملة واحدة. p_branch_ids = null تعني لا تُغيَّر، ومصفوفة فارغة تعني كل الفروع.';

commit;

-- ---------------------------------------------------------------------------
-- بعد التشغيل — التحقّق من الصفوف القديمة
--
-- القيود أعلاه `not valid`، فهي تحرس الجديد ولا تفحص القديم. شغّل هذا بعد
-- الهجرة؛ إن رفع خطأً فعندك صفوف عابرة للمنشآت يجب تصحيحها قبل التحقّق:
--
--   alter table item_branches    validate constraint item_branches_item_tenant_fk;
--   alter table item_branches    validate constraint item_branches_branch_tenant_fk;
--   alter table item_resources   validate constraint item_resources_item_tenant_fk;
--   alter table item_resources   validate constraint item_resources_resource_tenant_fk;
--   alter table item_claim_codes validate constraint item_claim_codes_item_tenant_fk;
--   alter table resources        validate constraint resources_branch_tenant_fk;
--   alter table price_lists      validate constraint price_lists_branch_tenant_fk;
--   alter table price_list_items validate constraint price_list_items_item_tenant_fk;
--   alter table price_list_items validate constraint price_list_items_list_tenant_fk;
--   alter table appointments     validate constraint appointments_item_tenant_fk;
--   alter table patient_visit_services validate constraint pvs_visit_tenant_fk;
-- ---------------------------------------------------------------------------
