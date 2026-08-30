-- 0073_service_clinical_and_lifecycle.sql
-- المرحلة الثالثة من كتالوج الخدمات: المتطلبات السريرية، الموارد، الموافقات،
-- أكواد المطالبات، ودورة حياة موحّدة للخدمة المقدَّمة.
--
-- مبدأ هذه الهجرة: **البناء فوق الموجود**. لا جدول موازٍ لما هو قائم:
--   • الموافقات المسبقة تُربط بجدول `insurance_preauthorizations` القائم،
--     ولا يُنشأ جدول موافقات ثانٍ.
--   • أكواد المطالبات تملأ `insurance_claim_form_items.service_code` القائم
--     الذي يُكتب اليوم يدويًا في كل مطالبة.
--   • دورة الحياة تُضاف كعمود على `patient_visit_services` القائم، وتتقدّم
--     تلقائيًا من الفوترة والتحصيل الموجودَين، لا من مسار جديد.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) المتطلبات السريرية والموافقات — أعمدة على `items`
--
-- كلها اختيارية وبقيم افتراضية غير مقيِّدة، فالخدمات القائمة لا يتغيّر
-- سلوكها بمجرّد تشغيل الهجرة.
-- ---------------------------------------------------------------------------
alter table items
  add column if not exists requires_fasting        boolean not null default false,
  add column if not exists fasting_hours           integer,
  add column if not exists preparation_ar          text,
  add column if not exists preparation_en          text,
  add column if not exists contraindications_ar    text,
  add column if not exists min_age_years           integer,
  add column if not exists max_age_years           integer,
  add column if not exists gender_restriction      text not null default 'any',
  add column if not exists requires_consent        boolean not null default false,
  add column if not exists consent_note_ar         text,
  add column if not exists requires_preauthorization boolean not null default false,
  add column if not exists requires_referral       boolean not null default false,
  add column if not exists preauthorization_note   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_gender_restriction_check') then
    alter table items add constraint items_gender_restriction_check
      check (gender_restriction in ('any','male','female'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_age_range_check') then
    alter table items add constraint items_age_range_check
      check (min_age_years is null or max_age_years is null or min_age_years <= max_age_years);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_fasting_hours_check') then
    alter table items add constraint items_fasting_hours_check
      check (fasting_hours is null or (fasting_hours > 0 and fasting_hours <= 72));
  end if;
end $$;

comment on column items.gender_restriction is 'any = بلا قيد. تُستعمل للخدمات النسائية أو الرجالية حصرًا.';
comment on column items.requires_preauthorization is 'الخدمة تحتاج موافقة تأمين مسبقة قبل التنفيذ.';
comment on column items.requires_referral is 'الخدمة لا تُطلب إلا بإحالة من طبيب.';

-- ---------------------------------------------------------------------------
-- 2) الموارد — غرفة، جهاز، سرير، كرسي
--
-- المورد يخصّ فرعًا (وقد يخصّ عيادة داخله). ربط الخدمة بالمورد يقول:
-- «هذه الخدمة لا تُنفَّذ إلا حيث يوجد هذا الجهاز» — وهو ما يجعل توفّر
-- الخدمة في الفرع مسألةً قابلة للفحص لا اجتهادًا من الموظف.
-- ---------------------------------------------------------------------------
create table if not exists resources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id) on delete set null,
  clinic_id       uuid references clinics(id) on delete set null,
  resource_type   text not null,
  code            text,
  name_ar         text not null,
  name_en         text,
  capacity        integer not null default 1,
  is_active       boolean not null default true,
  note            text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint resources_type_check check (
    resource_type in ('room','chair','bed','device','equipment','other')
  ),
  constraint resources_capacity_check check (capacity > 0)
);

create index if not exists idx_resources_org_branch on resources (organization_id, branch_id);
create unique index if not exists uq_resources_org_code
  on resources (organization_id, code) where code is not null;

create table if not exists item_resources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  resource_id     uuid not null references resources(id) on delete cascade,
  is_required     boolean not null default true,
  quantity        numeric not null default 1,
  created_at      timestamptz not null default now(),
  constraint item_resources_quantity_check check (quantity > 0)
);

create unique index if not exists uq_item_resources on item_resources (item_id, resource_id);
create index if not exists idx_item_resources_resource on item_resources (resource_id);

alter table resources enable row level security;
alter table item_resources enable row level security;

drop policy if exists resources_select on resources;
create policy resources_select on resources for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists resources_write on resources;
create policy resources_write on resources for all to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists item_resources_select on item_resources;
create policy item_resources_select on item_resources for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists item_resources_write on item_resources;
create policy item_resources_write on item_resources for all to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));

revoke all on resources from anon;
revoke all on item_resources from anon;
grant select, insert, update, delete on resources to authenticated;
grant select, insert, update, delete on item_resources to authenticated;

-- ---------------------------------------------------------------------------
-- 3) أكواد المطالبات
--
-- `insurance_claim_form_items.service_code` موجود منذ البداية ويُكتب يدويًا
-- في كل مطالبة. الكود الطبي خاصيّة **للخدمة** لا للمطالبة، وقد يختلف من
-- شركة تأمين لأخرى — لذا جدول بمستويين: كود عام للخدمة، وكود خاص بشركة
-- يتقدّم عليه.
-- ---------------------------------------------------------------------------
create table if not exists item_claim_codes (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  item_id              uuid not null references items(id) on delete cascade,
  insurance_company_id uuid references insurance_companies(id) on delete cascade,
  code_system          text not null default 'local',
  code                 text not null,
  description          text,
  is_primary           boolean not null default true,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  constraint item_claim_codes_system_check check (
    code_system in ('cpt','hcpcs','icd10','icd10am','snomed','loinc','local','other')
  )
);

-- كود رئيسي واحد لكل خدمة على المستوى العام، وواحد لكل شركة تأمين.
create unique index if not exists uq_item_claim_codes_primary_generic
  on item_claim_codes (item_id) where is_primary and insurance_company_id is null;
create unique index if not exists uq_item_claim_codes_primary_company
  on item_claim_codes (item_id, insurance_company_id) where is_primary and insurance_company_id is not null;
create index if not exists idx_item_claim_codes_item on item_claim_codes (item_id);

alter table item_claim_codes enable row level security;
drop policy if exists item_claim_codes_select on item_claim_codes;
create policy item_claim_codes_select on item_claim_codes for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists item_claim_codes_write on item_claim_codes;
create policy item_claim_codes_write on item_claim_codes for all to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));

revoke all on item_claim_codes from anon;
grant select, insert, update, delete on item_claim_codes to authenticated;

create or replace function app_item_claim_code(
  p_item_id uuid,
  p_insurance_company_id uuid default null
)
returns table (code text, code_system text, description text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.code, c.code_system, c.description
    from item_claim_codes c
    join items i on i.id = c.item_id
   where c.item_id = p_item_id
     and app_is_member(c.organization_id)
     and (c.insurance_company_id = p_insurance_company_id
          or c.insurance_company_id is null)
   order by
     -- كود الشركة أولًا، ثم العام، والرئيسي قبل البديل
     (c.insurance_company_id is null),
     (not c.is_primary),
     c.created_at
   limit 1;
$$;

comment on function app_item_claim_code(uuid, uuid) is
  'كود المطالبة المعتمد لخدمة: كود شركة التأمين إن وُجد، وإلا الكود العام.';

revoke all on function app_item_claim_code(uuid, uuid) from public, anon;
grant execute on function app_item_claim_code(uuid, uuid) to authenticated;

-- تعبئة `service_code` تلقائيًا عند إضافة سطر مطالبة مرتبط بخدمة.
-- لا يُكتب فوق قيمة أدخلها الموظف: الشرط `is null` مقصود.
create or replace function app_fill_claim_item_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_code    text;
  v_desc    text;
begin
  if new.item_id is null then
    return new;
  end if;

  if new.service_code is null or btrim(new.service_code) = '' then
    -- شركة التأمين تُستنتج من عضوية المريض المرتبطة بالنموذج:
    -- نموذج ← عضوية ← وثيقة ← شركة
    select pol.company_id into v_company
      from insurance_claim_forms f
      join patient_insurance_memberships m on m.id = f.membership_id
      join insurance_policies pol on pol.id = m.policy_id
     where f.id = new.form_id;

    select c.code, c.description into v_code, v_desc
      from item_claim_codes c
     where c.item_id = new.item_id
       and (c.insurance_company_id = v_company or c.insurance_company_id is null)
     order by (c.insurance_company_id is null), (not c.is_primary), c.created_at
     limit 1;

    if v_code is not null then
      new.service_code := v_code;
    end if;
  end if;

  if new.description is null or btrim(new.description) = '' then
    select coalesce(v_desc, i.name_ar) into new.description from items i where i.id = new.item_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fill_claim_item_code on insurance_claim_form_items;
create trigger trg_fill_claim_item_code
  before insert on insurance_claim_form_items
  for each row execute function app_fill_claim_item_code();

-- ---------------------------------------------------------------------------
-- 4) فحص ملاءمة الخدمة للمريض
--
-- تُعيد `blocks` (موانع) و`warnings` (تنبيهات). الفرق عملي: المانع يُوقف
-- الإضافة، والتنبيه يُعرض ويُمضى. عدّ الشرط الواحد مانعًا أو تنبيهًا قرارٌ
-- سريري، لا تقني — لذا العمر والجنس موانع، والصيام والموافقة تنبيهات
-- تُذكِّر الموظف بما يجب تجهيزه.
-- ---------------------------------------------------------------------------
create or replace function app_check_service_eligibility(
  p_item_id    uuid,
  p_patient_id uuid,
  p_branch_id  uuid default null
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
  v_preauth  text;
begin
  select * into v_item from items where id = p_item_id;
  if v_item.id is null then
    raise exception 'الخدمة غير موجودة';
  end if;
  if not app_is_member(v_item.organization_id) then
    raise exception 'لا صلاحية';
  end if;

  select * into v_patient from patients
   where id = p_patient_id and organization_id = v_item.organization_id;
  if v_patient.id is null then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  if v_item.is_archived then
    v_blocks := array_append(v_blocks, 'الخدمة مؤرشفة');
  elsif v_item.is_disabled then
    v_blocks := array_append(v_blocks, 'الخدمة معطَّلة');
  end if;

  if p_branch_id is not null and not app_item_available_in_branch(p_item_id, p_branch_id) then
    v_blocks := array_append(v_blocks, 'الخدمة غير متاحة في هذا الفرع');
  end if;

  -- العمر
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

  -- الجنس
  if v_item.gender_restriction <> 'any' then
    if v_patient.gender is null then
      v_warnings := array_append(v_warnings, 'الخدمة مقيّدة بالجنس وجنس المريض غير مسجَّل');
    elsif v_patient.gender <> v_item.gender_restriction then
      v_blocks := array_append(v_blocks,
        case v_item.gender_restriction when 'male' then 'الخدمة للذكور فقط'
                                       else 'الخدمة للإناث فقط' end);
    end if;
  end if;

  -- التحضير والموافقة
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

  -- الموافقة المسبقة — تُقرأ من جدول الموافقات القائم
  if v_item.requires_preauthorization then
    select p.status into v_preauth
      from insurance_preauthorizations p
     where p.patient_id = p_patient_id
       and p.organization_id = v_item.organization_id
       and p.status = 'approved'
       and p.requested_at > now() - interval '90 days'
     order by p.requested_at desc
     limit 1;

    if v_preauth is null then
      v_blocks := array_append(v_blocks, 'تتطلّب موافقة تأمين مسبقة، ولا توجد موافقة سارية للمريض');
    end if;
  end if;

  -- الموارد
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

comment on function app_check_service_eligibility(uuid, uuid, uuid) is
  'يفحص ملاءمة خدمة لمريض: العمر، الجنس، الفرع، الموارد، الموافقة المسبقة. blocks تمنع، warnings تُعرض.';

revoke all on function app_check_service_eligibility(uuid, uuid, uuid) from public, anon;
grant execute on function app_check_service_eligibility(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) دورة حياة الخدمة المقدَّمة
--
--   مسودة ← مطلوبة ← منفذة ← مفوترة ← مدفوعة/مطالب بها
--                                   ↘ ملغاة أو مستردة
--
-- الحالة تتقدّم **تلقائيًا** من الفوترة والتحصيل القائمَين، لأن حالةً
-- يحرّكها الموظف يدويًا تصير خانةً يُنسى تحديثها فلا يُوثق بها أحد.
-- ---------------------------------------------------------------------------
alter table patient_visit_services
  add column if not exists status            text not null default 'performed',
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists status_changed_by uuid references auth.users(id),
  add column if not exists status_note       text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_visit_services_status_check') then
    alter table patient_visit_services add constraint patient_visit_services_status_check
      check (status in ('draft','ordered','performed','invoiced','paid','claimed','cancelled','refunded'));
  end if;
end $$;

create index if not exists idx_pvs_status on patient_visit_services (organization_id, status);

comment on column patient_visit_services.status is
  'دورة حياة الخدمة: draft مسودة، ordered مطلوبة، performed منفذة، invoiced مفوترة، paid مدفوعة، claimed مطالب بها، cancelled ملغاة، refunded مستردة.';

-- تعبئة الحالة للصفوف القائمة بالأدلّة لا بالافتراض
update patient_visit_services s
   set status = case
     when inv.status = 'void'  then 'cancelled'
     when inv.status = 'paid'  then 'paid'
     when inv.id is not null   then 'invoiced'
     else 'performed'
   end
  from (
    select li.visit_service_id, i.id, i.status
      from sales_invoice_items li
      join sales_invoices i on i.id = li.invoice_id
     where li.visit_service_id is not null
  ) inv
 where inv.visit_service_id = s.id
   and s.status = 'performed';

-- خريطة الانتقالات المسموحة
create or replace function app_visit_service_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'     then p_to in ('ordered','performed','cancelled')
    when 'ordered'   then p_to in ('performed','cancelled')
    when 'performed' then p_to in ('invoiced','cancelled')
    when 'invoiced'  then p_to in ('paid','claimed','refunded','cancelled')
    when 'paid'      then p_to in ('claimed','refunded')
    when 'claimed'   then p_to in ('paid','refunded')
    else false   -- cancelled و refunded نهائيتان
  end;
$$;

create or replace function app_set_visit_service_status(
  p_visit_service_id uuid,
  p_status           text,
  p_note             text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row patient_visit_services%rowtype;
begin
  select * into v_row from patient_visit_services where id = p_visit_service_id for update;
  if v_row.id is null then
    raise exception 'الخدمة غير موجودة';
  end if;
  if not app_is_member(v_row.organization_id) then
    raise exception 'لا صلاحية';
  end if;
  if v_row.status = p_status then
    return;
  end if;
  if not app_visit_service_status_allowed(v_row.status, p_status) then
    raise exception 'لا يمكن الانتقال من «%» إلى «%»', v_row.status, p_status;
  end if;
  if p_status in ('cancelled','refunded') and (p_note is null or btrim(p_note) = '') then
    raise exception 'الإلغاء أو الاسترداد يحتاج سببًا مكتوبًا';
  end if;
  if p_status = 'cancelled' and exists (
       select 1 from sales_invoice_items li
        join sales_invoices i on i.id = li.invoice_id
       where li.visit_service_id = p_visit_service_id and i.status <> 'void'
     ) then
    raise exception 'الخدمة مفوترة على فاتورة سارية — ألغِ الفاتورة أولًا';
  end if;

  update patient_visit_services
     set status = p_status,
         status_changed_at = now(),
         status_changed_by = auth.uid(),
         status_note = coalesce(p_note, status_note)
   where id = p_visit_service_id;

  -- `action_type` مقيَّد بقائمة ثابتة منذ أول هجرة؛ نوع الحدث الحقيقي في `details`.
  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_row.organization_id, auth.uid(), 'services', 'update', p_visit_service_id,
          'خدمة زيارة', format('تغيير الحالة: %s ← %s', v_row.status, p_status), p_note);
end;
$$;

revoke all on function app_set_visit_service_status(uuid, text, text) from public, anon;
grant execute on function app_set_visit_service_status(uuid, text, text) to authenticated;

-- تقدُّم تلقائي عند الفوترة
create or replace function app_pvs_status_on_invoice_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type   text;
  v_status text;
begin
  if new.visit_service_id is null then
    return new;
  end if;
  select invoice_type, status into v_type, v_status
    from sales_invoices where id = new.invoice_id;

  if v_type = 'return' then
    update patient_visit_services
       set status = 'refunded', status_changed_at = now(),
           status_note = coalesce(status_note, 'فاتورة مرتجع')
     where id = new.visit_service_id and status in ('invoiced','paid','claimed');
  else
    -- فاتورة نقدية تُنشأ مدفوعةً من أول لحظة، فلا يقع عليها تحديثُ حالة
    -- لاحقًا يحرّك الخدمة. لو اكتفينا بـ«مفوترة» لبقيت كذلك أبدًا.
    update patient_visit_services
       set status = case when v_status = 'paid' then 'paid' else 'invoiced' end,
           status_changed_at = now()
     where id = new.visit_service_id and status in ('draft','ordered','performed');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pvs_status_on_invoice_item on sales_invoice_items;
create trigger trg_pvs_status_on_invoice_item
  after insert on sales_invoice_items
  for each row execute function app_pvs_status_on_invoice_item();

-- الاسترداد لا يُعرف من سطر المرتجع
--
-- `uq_invoice_item_visit_service` (من 0057) تمنع ظهور خدمة الزيارة على أكثر
-- من سطر فاتورة واحد — وهو حارس صحيح ضدّ الفوترة المكرّرة، لكنه يعني أن
-- فاتورة المرتجع **لا تحمل** معرّف خدمة الزيارة. فالمرتجع يُعرف من
-- `original_invoice_id`، ومنه نصل إلى خدمات الفاتورة الأصلية.
create or replace function app_pvs_status_on_return_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.invoice_type <> 'return' or new.original_invoice_id is null then
    return new;
  end if;

  update patient_visit_services s
     set status = 'refunded',
         status_changed_at = now(),
         status_note = coalesce(s.status_note, 'فاتورة مرتجع')
    from sales_invoice_items li
   where li.invoice_id = new.original_invoice_id
     and li.visit_service_id = s.id
     and s.status in ('invoiced','paid','claimed');

  return new;
end;
$$;

drop trigger if exists trg_pvs_status_on_return_invoice on sales_invoices;
create trigger trg_pvs_status_on_return_invoice
  after insert on sales_invoices
  for each row execute function app_pvs_status_on_return_invoice();

-- تقدُّم تلقائي عند تغيّر حالة الفاتورة
create or replace function app_pvs_status_on_invoice_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'paid' then
    update patient_visit_services s
       set status = 'paid', status_changed_at = now()
      from sales_invoice_items li
     where li.invoice_id = new.id and li.visit_service_id = s.id
       and s.status in ('invoiced','claimed');
  elsif new.status = 'void' then
    -- إبطال الفاتورة يُعيد الخدمة إلى «منفذة» كي تُفوتر من جديد،
    -- ولا يُلغيها: الخدمة نُفِّذت فعلًا والخطأ في الفاتورة لا فيها.
    update patient_visit_services s
       set status = 'performed', status_changed_at = now(),
           status_note = 'أُبطلت الفاتورة'
      from sales_invoice_items li
     where li.invoice_id = new.id and li.visit_service_id = s.id
       and s.status in ('invoiced','paid','claimed');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pvs_status_on_invoice_status on sales_invoices;
create trigger trg_pvs_status_on_invoice_status
  after update of status on sales_invoices
  for each row execute function app_pvs_status_on_invoice_status();

-- تقدُّم تلقائي عند ضمّ الفاتورة إلى دفعة مطالبات
create or replace function app_pvs_status_on_claim()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update patient_visit_services s
     set status = 'claimed', status_changed_at = now()
    from sales_invoice_items li
   where li.invoice_id = new.sales_invoice_id and li.visit_service_id = s.id
     and s.status = 'invoiced';
  return new;
end;
$$;

drop trigger if exists trg_pvs_status_on_claim on insurance_claim_batch_items;
create trigger trg_pvs_status_on_claim
  after insert on insurance_claim_batch_items
  for each row execute function app_pvs_status_on_claim();

-- ---------------------------------------------------------------------------
-- 6) منظور الكتالوج الكامل — يحلّ محلّ v_service_catalog بأعمدة المرحلة ٣
-- ---------------------------------------------------------------------------
drop view if exists v_service_catalog;
create view v_service_catalog as
select
  i.id,
  i.organization_id,
  i.code,
  i.barcode,
  i.name_ar,
  i.name_en,
  i.description_ar,
  i.description_en,
  i.item_type,
  i.medical_service_type,
  i.category_value_id,
  i.default_clinic_id,
  c.name              as clinic_name,
  i.duration_minutes,
  i.provider_role,
  i.requires_appointment,
  i.price,
  i.cost_price,
  i.default_discount_percent,
  i.is_vat_exempt,
  i.revenue_account_id,
  i.cogs_account_id,
  i.is_disabled,
  i.requires_fasting,
  i.fasting_hours,
  i.preparation_ar,
  i.min_age_years,
  i.max_age_years,
  i.gender_restriction,
  i.requires_consent,
  i.requires_preauthorization,
  i.requires_referral,
  coalesce(b.branch_ids, '{}') as branch_ids,
  coalesce(r.resource_ids, '{}') as resource_ids,
  cc.code        as primary_claim_code,
  cc.code_system as primary_claim_code_system,
  i.created_at,
  i.updated_at
from items i
left join clinics c on c.id = i.default_clinic_id
left join lateral (
  select array_agg(ib.branch_id) as branch_ids
    from item_branches ib where ib.item_id = i.id
) b on true
left join lateral (
  select array_agg(ir.resource_id) as resource_ids
    from item_resources ir where ir.item_id = i.id
) r on true
left join lateral (
  select x.code, x.code_system
    from item_claim_codes x
   where x.item_id = i.id and x.insurance_company_id is null and x.is_primary
   limit 1
) cc on true
where not i.is_archived;

alter view v_service_catalog set (security_invoker = on);
revoke all on v_service_catalog from anon;
grant select on v_service_catalog to authenticated;

-- ---------------------------------------------------------------------------
-- 7) منظور الخدمات المقدَّمة بحالاتها — لمتابعة ما نُفِّذ ولم يُفوتر
-- ---------------------------------------------------------------------------
create or replace view v_visit_services_status as
select
  s.id,
  s.organization_id,
  s.visit_id,
  v.patient_id,
  p.name_ar        as patient_name,
  s.item_id,
  i.name_ar        as item_name,
  i.medical_service_type,
  s.qty,
  s.unit_price,
  (s.qty * coalesce(s.unit_price, 0)) as line_total,
  s.status,
  s.status_changed_at,
  s.status_note,
  s.performed_by,
  li.invoice_id,
  v.visit_date,
  s.created_at
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join patients p on p.id = v.patient_id
join items i on i.id = s.item_id
left join lateral (
  select li.invoice_id from sales_invoice_items li
   where li.visit_service_id = s.id order by li.created_at desc limit 1
) li on true;

alter view v_visit_services_status set (security_invoker = on);
revoke all on v_visit_services_status from anon;
grant select on v_visit_services_status to authenticated;

commit;
