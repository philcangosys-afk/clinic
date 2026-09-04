-- ==========================================================================
-- ZainCare — الجزء 3 — الهجرات الجوهرية 0113–0135 (بلا بيانات تجريبية)
-- ==========================================================================
-- انسخ الملف كاملًا في محرّر SQL في Supabase واضغط Run مرة واحدة.
-- يُنفَّذ كمعاملة واحدة: إمّا أن ينجح كلّه أو لا يتغيّر شيء.
-- يُشغَّل **بعد** الجزء 1 والجزء 2.
--
-- ⚠️ تحذير في 0117: يفرض أن تكون كل منشأة من نوع `medical_center`
--    ويمنع أي نوع آخر بقيد قاعدة بيانات. راجع ملاحظاتي قبل التشغيل.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.**
-- ==========================================================================



-- ==========================================================================
-- [1/21]  0113_function_execution_hardening.sql
--          تشديد صلاحيات تنفيذ الدوالّ
-- ==========================================================================


do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
  end loop;
end
$$;

revoke all on function app_mark_integration_attempt(text, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function app_mark_integration_attempt(text, uuid, boolean, text)
  to service_role;

revoke all on function app_claim_pending_messages(integer)
  from public, anon, authenticated;
grant execute on function app_claim_pending_messages(integer)
  to service_role;

revoke all on function app_mark_message_sent(bigint, text)
  from public, anon, authenticated;
grant execute on function app_mark_message_sent(bigint, text)
  to service_role;

revoke all on function app_mark_message_failed(bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function app_mark_message_failed(bigint, text, boolean)
  to service_role;


-- ==========================================================================
-- [2/21]  0114_app_function_search_path_hardening.sql
--          تثبيت search_path على دوالّ التطبيق
-- ==========================================================================


do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'app\_%' escape '\'
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);
    execute format('revoke execute on function %s from public, anon', fn.signature);
  end loop;
end
$$;


-- ==========================================================================
-- [3/21]  0115_trigger_function_api_lockdown.sql
--          إغلاق دوالّ المحفِّزات أمام الواجهة
-- ==========================================================================


do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      fn.signature
    );
  end loop;
end
$$;


-- ==========================================================================
-- [4/21]  0116_stages_11_32_baseline_verification.sql
--          تحقّق من اكتمال المراحل 11–32
-- ==========================================================================


do $$
begin
  if not (
    to_regprocedure('public.app_create_invoice_from_visit(uuid,boolean,uuid,text)') is not null
    and to_regprocedure('public.app_generate_einvoice(uuid)') is not null
    and to_regprocedure('public.app_create_claim_from_visit(uuid,uuid,text)') is not null
    and to_regclass('public.v_report_revenue') is not null
    -- توقيعان مقبولان: الخماسي (المرحلة 15) والسداسي بعد أن أضافت 0125
    -- وسيطًا سادسًا وأسقطت الخماسي. تثبيت الخماسي وحده كان يجعل إعادة تشغيل
    -- هذا الملف تفشل بعد 0125 برسالة «كائن رئيسي غير موجود» — والكائن موجود
    -- بتوقيع أحدث. التحقّق يسأل عن الدالّة لا عن شكل توقيعها.
    and (to_regprocedure('public.app_log_record_access(uuid,text,text,text,uuid)') is not null
      or to_regprocedure('public.app_log_record_access(uuid,text,text,text,uuid,text)') is not null)
    and to_regprocedure('public.app_sell_package(uuid,uuid,uuid,uuid,uuid,text)') is not null
    and to_regprocedure('public.app_create_purchase_order(uuid,uuid,date,text)') is not null
    and to_regprocedure('public.app_start_stock_count(uuid,text,text,uuid[],text)') is not null
    and to_regprocedure('public.app_post_journal_entry(uuid)') is not null
    and to_regprocedure('public.app_calculate_payroll_run(uuid)') is not null
    and to_regprocedure('public.app_post_asset_depreciation(uuid,date)') is not null
    and to_regprocedure('public.app_sign_document(text,uuid,text,text,text,text,text,text,text)') is not null
    and to_regprocedure('public.app_notify_event(uuid,text,text,text,text,text,uuid,text,uuid)') is not null
    and to_regprocedure('public.app_portal_request_appointment(uuid,uuid,uuid,date,text,text)') is not null
    and to_regprocedure('public.app_acknowledge_critical_result(uuid,text,text)') is not null
    and to_regprocedure('public.app_report_quality_incident(uuid,text,text,text,uuid,uuid,timestamptz,text,text,boolean)') is not null
    and to_regprocedure('public.app_save_org_policies(uuid,jsonb)') is not null
    and to_regprocedure('public.app_set_membership_role(uuid,uuid,text,text)') is not null
    and to_regprocedure('public.app_save_locale_settings(uuid,jsonb)') is not null
    and to_regprocedure('public.app_mark_integration_attempt(text,uuid,boolean,text)') is not null
    and to_regprocedure('public.app_analytics_summary(uuid,date,date)') is not null
    and to_regprocedure('public.app_launch_readiness(uuid)') is not null
  ) then
    raise exception 'فشل تحقق Baseline للمراحل 11-32: كائن رئيسي واحد أو أكثر غير موجود';
  end if;
end
$$;


-- ==========================================================================
-- [5/21]  0117_unified_medical_center.sql
--          توحيد نوع المنشأة: مركز طبي فقط ⚠️
-- ==========================================================================


update public.organizations
set organization_type = 'medical_center'
where organization_type <> 'medical_center';

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'organizations'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%organization_type%'
  loop
    execute format('alter table public.organizations drop constraint %I', constraint_name);
  end loop;
end
$$;

alter table public.organizations
  add constraint organizations_medical_center_only_check
  check (organization_type = 'medical_center');

insert into public.organization_features (organization_id, feature_key, enabled)
select organization.id, feature.feature_key, true
from public.organizations organization
cross join public.feature_catalog feature
on conflict (organization_id, feature_key)
do update set enabled = true;

create or replace function public.app_enable_all_organization_features()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.organization_features (organization_id, feature_key, enabled)
  select new.id, feature_key, true
  from public.feature_catalog
  on conflict (organization_id, feature_key)
  do update set enabled = true;

  return new;
end
$$;

revoke all on function public.app_enable_all_organization_features() from public, anon, authenticated;
grant execute on function public.app_enable_all_organization_features() to service_role;

drop trigger if exists trg_enable_all_organization_features on public.organizations;
create trigger trg_enable_all_organization_features
  after insert on public.organizations
  for each row execute function public.app_enable_all_organization_features();


-- ==========================================================================
-- [6/21]  0120_notifications_security_hardening.sql
--          تشديد أمن التنبيهات
-- ==========================================================================


create or replace function public.app_mark_all_notifications_read(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'غير مسجَّل الدخول';
  end if;

  if not public.app_is_member(p_org) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;

  update public.notifications
     set read_at = now()
   where organization_id = p_org
     and user_id = auth.uid()
     and read_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare
  v_signature regprocedure;
begin
  for v_signature in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_notify',
         'app_notify_event',
         'app_users_with_permission',
         'app_seed_notification_rules'
       )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_signature
    );
  end loop;
end;
$$;

revoke all on function public.app_mark_all_notifications_read(uuid) from public, anon;
grant execute on function public.app_mark_all_notifications_read(uuid) to authenticated;


-- ==========================================================================
-- [7/21]  0121_atomic_medical_center_onboarding.sql
--          تهيئة المركز الطبي في عملية ذرّية
-- ==========================================================================


create or replace function public.app_create_medical_center(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_branch_id uuid;
  v_feature_count integer;
  v_enabled_count integer;
begin
  if v_user_id is null then
    raise exception 'غير مسجَّل الدخول';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'اسم المركز مطلوب';
  end if;

  if length(btrim(p_name)) > 200 then
    raise exception 'اسم المركز أطول من الحد المسموح';
  end if;

  if exists (
    select 1
      from public.organization_memberships
     where user_id = v_user_id
       and is_active
  ) then
    raise exception 'لديك عضوية نشطة بالفعل';
  end if;

  insert into public.organizations (name, organization_type, created_by)
  values (btrim(p_name), 'medical_center', v_user_id)
  returning id into v_organization_id;

  select branch_id
    into v_branch_id
    from public.organization_memberships
   where organization_id = v_organization_id
     and user_id = v_user_id
     and role_key = 'owner'
     and is_active;

  if v_branch_id is null or not exists (
    select 1
      from public.branches
     where id = v_branch_id
       and organization_id = v_organization_id
       and is_main
  ) then
    raise exception 'تعذر إنشاء الفرع الرئيسي وعضوية المالك';
  end if;

  select count(*) into v_feature_count from public.feature_catalog;
  select count(*) into v_enabled_count
    from public.organization_features
   where organization_id = v_organization_id
     and enabled;

  if v_enabled_count <> v_feature_count then
    raise exception 'تعذر تفعيل جميع وحدات المركز';
  end if;

  return v_organization_id;
end;
$$;

revoke all on function public.app_create_medical_center(text) from public, anon;
grant execute on function public.app_create_medical_center(text) to authenticated;


-- ==========================================================================
-- [8/21]  0122_vat_rate_source_sync.sql
--          توحيد مصدر نسبة الضريبة
-- ==========================================================================


update public.organizations organization
   set default_vat_rate = settings.default_vat_rate
  from public.organization_vat_settings settings
 where settings.organization_id = organization.id
   and organization.default_vat_rate is distinct from settings.default_vat_rate;

create or replace function public.app_sync_vat_rate_from_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.organizations
     set default_vat_rate = new.default_vat_rate
   where id = new.organization_id
     and default_vat_rate is distinct from new.default_vat_rate;
  return new;
end;
$$;

create or replace function public.app_sync_vat_rate_from_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.organization_vat_settings
     set default_vat_rate = new.default_vat_rate,
         updated_at = now()
   where organization_id = new.id
     and default_vat_rate is distinct from new.default_vat_rate;
  return new;
end;
$$;

revoke all on function public.app_sync_vat_rate_from_settings() from public, anon, authenticated;
revoke all on function public.app_sync_vat_rate_from_organization() from public, anon, authenticated;
grant execute on function public.app_sync_vat_rate_from_settings() to service_role;
grant execute on function public.app_sync_vat_rate_from_organization() to service_role;

drop trigger if exists trg_sync_vat_rate_from_settings on public.organization_vat_settings;
create trigger trg_sync_vat_rate_from_settings
after insert or update of default_vat_rate on public.organization_vat_settings
for each row execute function public.app_sync_vat_rate_from_settings();

drop trigger if exists trg_sync_vat_rate_from_organization on public.organizations;
create trigger trg_sync_vat_rate_from_organization
after update of default_vat_rate on public.organizations
for each row execute function public.app_sync_vat_rate_from_organization();


-- ==========================================================================
-- [9/21]  0123_background_function_lockdown.sql
--          إغلاق دوالّ المهام الخلفية
-- ==========================================================================


create or replace function public.app_guard_definer_grants()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_object record;
begin
  for v_object in select * from pg_event_trigger_ddl_commands()
  loop
    if v_object.object_type = 'function' and exists (
      select 1
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where procedure.oid = v_object.objid
         and namespace.nspname = 'public'
         and procedure.prosecdef
    ) then
      execute format('revoke all on function %s from public, anon', v_object.objid::regprocedure);
    end if;
  end loop;
end;
$$;

do $$
declare
  v_signature regprocedure;
begin
  for v_signature in
    select procedure.oid::regprocedure
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname in (
         'app_guard_definer_grants',
         'app_mark_integration_attempt',
         'app_claim_pending_messages',
         'app_mark_message_sent',
         'app_mark_message_failed',
         'app_process_due_appointment_reminders',
         'app_setup_reminder_schedules',
         'app_seed_integration_rules',
         'app_seed_quality_indicators',
         'app_seed_asset_depreciation_rule',
         'app_seed_default_chart_of_accounts',
         'app_seed_gl_posting_rules'
       )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_signature
    );
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;


-- ==========================================================================
-- [10/21]  0124_launch_path_foreign_key_indexes.sql
--          فهارس المفاتيح الأجنبية في مسار الإطلاق
-- ==========================================================================


create index if not exists idx_appointments_branch_fk on public.appointments (branch_id);
create index if not exists idx_appointments_clinic_fk on public.appointments (clinic_id);
create index if not exists idx_appointments_org_item_fk on public.appointments (organization_id, item_id);
create index if not exists idx_patients_branch_fk on public.patients (branch_id);

create index if not exists idx_sales_invoices_branch_fk on public.sales_invoices (branch_id);
create index if not exists idx_sales_invoices_clinic_fk on public.sales_invoices (clinic_id);
create index if not exists idx_sales_invoices_appointment_fk on public.sales_invoices (appointment_id);
create index if not exists idx_sales_invoices_org_visit_fk on public.sales_invoices (organization_id, visit_id);
create index if not exists idx_sales_invoice_items_item_fk on public.sales_invoice_items (item_id);
create index if not exists idx_sales_invoice_items_patient_fk on public.sales_invoice_items (patient_id);

create index if not exists idx_lab_tests_billing_item_fk on public.lab_tests (billing_item_id);
create index if not exists idx_lab_tests_category_fk on public.lab_tests (category_id);
create index if not exists idx_radiology_exams_billing_item_fk on public.radiology_exams (billing_item_id);
create index if not exists idx_radiology_exams_category_fk on public.radiology_exams (category_id);

create index if not exists idx_lab_orders_branch_fk on public.lab_orders (branch_id);
create index if not exists idx_lab_orders_clinic_fk on public.lab_orders (clinic_id);
create index if not exists idx_lab_orders_doctor_fk on public.lab_orders (ordering_doctor_id);
create index if not exists idx_lab_orders_invoice_fk on public.lab_orders (sales_invoice_id);
create index if not exists idx_lab_order_items_test_fk on public.lab_order_items (lab_test_id);

create index if not exists idx_radiology_orders_branch_fk on public.radiology_orders (branch_id);
create index if not exists idx_radiology_orders_clinic_fk on public.radiology_orders (clinic_id);
create index if not exists idx_radiology_orders_doctor_fk on public.radiology_orders (ordering_doctor_id);
create index if not exists idx_radiology_orders_invoice_fk on public.radiology_orders (sales_invoice_id);
create index if not exists idx_radiology_order_items_exam_fk on public.radiology_order_items (radiology_exam_id);

create index if not exists idx_prescriptions_branch_fk on public.prescriptions (branch_id);
create index if not exists idx_prescriptions_doctor_fk on public.prescriptions (doctor_id);
create index if not exists idx_prescriptions_warehouse_fk on public.prescriptions (warehouse_id);
create index if not exists idx_prescription_items_drug_fk on public.prescription_items (drug_item_id);

create index if not exists idx_medical_access_branch_fk on public.medical_record_access_log (branch_id);
create index if not exists idx_medical_access_patient_fk on public.medical_record_access_log (patient_id);
create index if not exists idx_medical_access_user_fk on public.medical_record_access_log (user_id);
create index if not exists idx_medical_access_visit_fk on public.medical_record_access_log (visit_id);
create index if not exists idx_notifications_branch_fk on public.notifications (branch_id);
create index if not exists idx_notifications_user_fk on public.notifications (user_id);


-- ==========================================================================
-- [11/21]  0125_medical_record_access_detail.sql
--          تفصيل سجل الاطّلاع على الملف الطبي
-- ==========================================================================


alter table public.medical_record_access_log
  add column if not exists device_name text;

drop function if exists public.app_log_record_access(uuid, text, text, text, uuid);

-- `create` وحدها تفشل عند إعادة التشغيل بـ«function already exists»؛
-- `create or replace` تجعل الهجرة قابلة للإعادة بلا أثر.
create or replace function public.app_log_record_access(
  p_patient_id uuid,
  p_access_type text default 'view',
  p_context text default null,
  p_reason text default null,
  p_visit_id uuid default null,
  p_device_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_branch uuid;
  v_id uuid;
begin
  select organization_id, branch_id
    into v_org, v_branch
    from public.patients
   where id = p_patient_id;

  if v_org is null then
    raise exception 'المريض غير موجود';
  end if;
  if not public.app_is_member(v_org) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if p_access_type not in ('view', 'print', 'export', 'download', 'search') then
    raise exception 'نوع الوصول غير صالح';
  end if;

  if p_visit_id is not null then
    select visit.branch_id
      into v_branch
      from public.patient_visits visit
     where visit.id = p_visit_id
       and visit.patient_id = p_patient_id
       and visit.organization_id = v_org;
    if not found then
      raise exception 'الزيارة لا تخص المريض المحدد';
    end if;
  end if;

  insert into public.medical_record_access_log (
    organization_id, branch_id, patient_id, user_id, access_type,
    context, reason, visit_id, device_name
  ) values (
    v_org, v_branch, p_patient_id, auth.uid(), p_access_type,
    nullif(trim(p_context), ''), nullif(trim(p_reason), ''), p_visit_id,
    left(nullif(trim(p_device_name), ''), 250)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.app_log_record_access(uuid, text, text, text, uuid, text)
  from public, anon;
grant execute on function public.app_log_record_access(uuid, text, text, text, uuid, text)
  to authenticated;

create or replace view public.v_medical_record_access_log_detail
with (security_invoker = on) as
select
  log.id,
  log.organization_id,
  log.branch_id,
  branch.name as branch_name,
  log.patient_id,
  patient.name_ar as patient_name,
  patient.file_number,
  log.user_id,
  coalesce(member.display_name, 'مستخدم غير محدد') as user_name,
  log.access_type,
  log.context,
  log.reason,
  log.device_name,
  log.visit_id,
  log.document_id,
  log.occurred_at
from public.medical_record_access_log log
join public.patients patient on patient.id = log.patient_id
left join public.branches branch on branch.id = log.branch_id
left join public.v_organization_members_directory member
  on member.organization_id = log.organization_id
 and member.user_id = log.user_id;

grant select on public.v_medical_record_access_log_detail to authenticated;
revoke all on public.v_medical_record_access_log_detail from anon;


-- ==========================================================================
-- [12/21]  0126_medical_access_view_security.sql
--          تأمين عرض سجل الاطّلاع
-- ==========================================================================


drop view if exists public.v_medical_record_access_log_detail;
create view public.v_medical_record_access_log_detail
with (security_invoker = on) as
select
  log.id,
  log.organization_id,
  log.branch_id,
  branch.name as branch_name,
  log.patient_id,
  patient.name_ar as patient_name,
  patient.file_number,
  log.user_id,
  coalesce(member.display_name, 'مستخدم غير محدد') as user_name,
  log.access_type,
  log.context,
  log.reason,
  log.device_name,
  log.visit_id,
  log.document_id,
  log.occurred_at
from public.medical_record_access_log log
join public.patients patient on patient.id = log.patient_id
left join public.branches branch on branch.id = log.branch_id
left join public.v_organization_members_directory member
  on member.organization_id = log.organization_id
 and member.user_id = log.user_id;

grant select on public.v_medical_record_access_log_detail to authenticated;
revoke all on public.v_medical_record_access_log_detail from anon;


-- ==========================================================================
-- [13/21]  0128_public_booking_website.sql
--          موقع الحجز العام
-- ==========================================================================

create table if not exists public.public_booking_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  public_slug text not null unique,
  site_name text not null,
  branch_id uuid not null references public.branches(id),
  hero_title text not null,
  hero_subtitle text,
  phone text,
  address text,
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_booking_slug_format check (public_slug ~ '^[a-z0-9][a-z0-9-]{2,62}$')
);

alter table public.public_booking_settings enable row level security;

-- إسقاطٌ أولًا حتى تُعاد الهجرة بلا «policy already exists».
drop policy if exists public_booking_settings_members on public.public_booking_settings;
create policy public_booking_settings_members
  on public.public_booking_settings
  for all to authenticated
  using (public.app_is_member(organization_id))
  with check (public.app_is_member(organization_id));

create table if not exists public.public_booking_rate_limits (
  id bigint generated always as identity primary key,
  booking_key text not null,
  created_at timestamptz not null default now()
);

alter table public.public_booking_rate_limits enable row level security;
create index if not exists idx_public_booking_rate_limits_key_time
  on public.public_booking_rate_limits (booking_key, created_at desc);

create or replace function public.app_public_booking_catalog(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_result jsonb;
begin
  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;

  if v_setting.organization_id is null then
    raise exception 'موقع الحجز غير متاح';
  end if;

  select jsonb_build_object(
    'site_name', v_setting.site_name,
    'hero_title', v_setting.hero_title,
    'hero_subtitle', v_setting.hero_subtitle,
    'phone', v_setting.phone,
    'address', v_setting.address,
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name
      ) order by c.sort_order, c.name)
      from public.clinics c
      where c.organization_id = v_setting.organization_id
        and c.branch_id = v_setting.branch_id
        and c.allows_online_booking
        and not c.is_disabled
    ), '[]'::jsonb),
    'doctors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name_ar,
        'job_title', d.job_title,
        'clinic_id', d.clinic_id
      ) order by d.name_ar)
      from public.doctors d
      where d.organization_id = v_setting.organization_id
        and d.is_enabled
        and not d.disabled_from_booking
        and exists (
          select 1
            from public.clinics c
           where c.id = d.clinic_id
             and c.organization_id = d.organization_id
             and c.branch_id = v_setting.branch_id
             and c.allows_online_booking
             and not c.is_disabled
        )
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'name', i.name_ar,
        'description', i.description_ar,
        'price', i.price,
        'duration_minutes', coalesce(i.duration_minutes, 30),
        'clinic_id', i.default_clinic_id
      ) order by i.name_ar)
      from public.items i
      where i.organization_id = v_setting.organization_id
        and i.item_type = 'service'
        and i.medical_service_type = 'dental'
        and not i.is_disabled
        and not i.is_archived
        and exists (
          select 1
            from public.clinics c
           where c.id = i.default_clinic_id
             and c.organization_id = i.organization_id
             and c.branch_id = v_setting.branch_id
             and c.allows_online_booking
             and not c.is_disabled
        )
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.app_public_create_booking(
  p_slug text,
  p_name text,
  p_mobile text,
  p_email text,
  p_gender text,
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_item_id uuid,
  p_scheduled_start timestamptz,
  p_note text default null,
  p_consent boolean default false,
  p_website text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_mobile text := regexp_replace(coalesce(p_mobile, ''), '[^0-9+]', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_clinic public.clinics%rowtype;
  v_doctor public.doctors%rowtype;
  v_item public.items%rowtype;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_invoice_id uuid;
  v_duration integer;
  v_scheduled_end timestamptz;
  v_vat_rate numeric := 0;
  v_taxable numeric(14,2);
  v_vat numeric(14,2);
  v_net numeric(14,2);
  v_booking_key text;
begin
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    raise exception 'تعذر إرسال الطلب';
  end if;

  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;

  if v_setting.organization_id is null then
    raise exception 'موقع الحجز غير متاح';
  end if;

  if char_length(v_name) < 3 or char_length(v_name) > 120 then
    raise exception 'أدخل الاسم الكامل';
  end if;
  if v_mobile !~ '^\+?[0-9]{8,15}$' then
    raise exception 'رقم الجوال غير صحيح';
  end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'البريد الإلكتروني غير صحيح';
  end if;
  if p_gender not in ('male', 'female') then
    raise exception 'اختر الجنس';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'يجب الموافقة على استخدام البيانات لإتمام الحجز';
  end if;
  if p_scheduled_start < now() + interval '1 hour'
     or p_scheduled_start > now() + interval '90 days' then
    raise exception 'اختر موعدًا خلال 90 يومًا وبفاصل ساعة على الأقل';
  end if;

  select * into v_clinic
    from public.clinics
   where id = p_clinic_id
     and organization_id = v_setting.organization_id
     and branch_id = v_setting.branch_id
     and allows_online_booking
     and not is_disabled;
  if v_clinic.id is null then raise exception 'العيادة غير متاحة للحجز الإلكتروني'; end if;

  select * into v_doctor
    from public.doctors
   where id = p_doctor_id
     and organization_id = v_setting.organization_id
     and clinic_id = v_clinic.id
     and is_enabled
     and not disabled_from_booking;
  if v_doctor.id is null then raise exception 'الطبيب غير متاح في العيادة المختارة'; end if;

  select * into v_item
    from public.items
   where id = p_item_id
     and organization_id = v_setting.organization_id
     and default_clinic_id = v_clinic.id
     and item_type = 'service'
     and medical_service_type = 'dental'
     and not is_disabled
     and not is_archived;
  if v_item.id is null then raise exception 'الخدمة غير متاحة للحجز الإلكتروني'; end if;

  v_duration := greatest(5, least(240, coalesce(v_item.duration_minutes, v_doctor.default_appointment_duration_minutes, v_clinic.default_visit_duration, 30)));
  v_scheduled_end := p_scheduled_start + make_interval(mins => v_duration);

  if exists (
    select 1 from public.appointments a
     where a.organization_id = v_setting.organization_id
       and a.doctor_id = v_doctor.id
       and a.status not in ('completed', 'no_show', 'cancelled_by_patient', 'cancelled_by_staff')
       and tstzrange(a.scheduled_start, a.scheduled_end, '[)') && tstzrange(p_scheduled_start, v_scheduled_end, '[)')
  ) then
    raise exception 'هذا الوقت محجوز، اختر وقتًا آخر';
  end if;

  v_booking_key := md5(v_setting.public_slug || ':' || v_mobile);
  if (select count(*) from public.public_booking_rate_limits
       where booking_key = v_booking_key
         and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'تم إرسال عدة حجوزات لهذا الرقم؛ حاول لاحقًا';
  end if;
  insert into public.public_booking_rate_limits (booking_key) values (v_booking_key);

  if exists (
    select 1 from public.blocked_external_contacts b
     where b.organization_id = v_setting.organization_id
       and b.is_active
       and b.block_type in ('booking', 'all')
       and regexp_replace(coalesce(b.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
       and b.starts_at <= now()
       and (b.ends_at is null or b.ends_at > now())
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  select p.id into v_patient_id
    from public.patients p
   where p.organization_id = v_setting.organization_id
     and regexp_replace(coalesce(p.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
     and lower(regexp_replace(btrim(p.name_ar), '\s+', ' ', 'g')) = lower(v_name)
   order by p.created_at
   limit 1;

  if v_patient_id is not null and exists (
    select 1 from public.patients p
     where p.id = v_patient_id and p.block_appointments
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  if v_patient_id is null then
    insert into public.patients (
      organization_id, branch_id, name_ar, mobile_number, email_1,
      gender, preferred_language, treating_doctor_id, source_details,
      block_sms, block_sms_reason
    ) values (
      v_setting.organization_id, v_setting.branch_id, v_name, v_mobile, v_email,
      p_gender, 'ar', v_doctor.id, 'الموقع الإلكتروني',
      true, 'إرسال الرسائل الخارجية مؤجل'
    ) returning id into v_patient_id;
  end if;

  insert into public.appointments (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, item_id,
    scheduled_start, scheduled_end, status, priority, note
  ) values (
    v_setting.organization_id, v_setting.branch_id, v_clinic.id, v_doctor.id,
    v_patient_id, v_item.id, p_scheduled_start, v_scheduled_end,
    'new', 'normal', concat_ws(E'\n', 'حجز من الموقع الإلكتروني', nullif(btrim(coalesce(p_note, '')), ''))
  ) returning id into v_appointment_id;

  select case
           when i.is_vat_exempt or i.vat_category in ('zero_rated', 'exempt', 'out_of_scope') then 0
           when not coalesce(s.sales_vat_enabled, true) then 0
           else coalesce(i.vat_rate_override, o.default_vat_rate, 0)
         end
    into v_vat_rate
    from public.items i
    join public.organizations o on o.id = i.organization_id
    left join public.organization_vat_settings s on s.organization_id = i.organization_id
   where i.id = v_item.id;

  v_taxable := round(v_item.price, 2);
  v_vat := round(v_taxable * v_vat_rate / 100.0, 2);
  v_net := v_taxable + v_vat;

  insert into public.sales_invoices (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, appointment_id,
    invoice_type, status, document_type, subtotal_amount, vat_amount, net_amount,
    paid_amount, patient_share_amount, note
  ) values (
    v_setting.organization_id, v_setting.branch_id, v_clinic.id, v_doctor.id,
    v_patient_id, v_appointment_id, 'sale', 'draft', 'simplified',
    v_taxable, v_vat, v_net, 0, v_net, 'مسودة آلية مرتبطة بحجز الموقع الإلكتروني'
  ) returning id into v_invoice_id;

  insert into public.sales_invoice_items (
    invoice_id, organization_id, branch_id, patient_id, item_id, doctor_id,
    description, item_name_snapshot, qty, price, discount_percent,
    discount_amount, vat_rate, vat_amount, taxable_base, exemption_amount,
    net_amount, line_type, source_type, source_id, vat_category
  ) values (
    v_invoice_id, v_setting.organization_id, v_setting.branch_id, v_patient_id,
    v_item.id, v_doctor.id, v_item.name_ar, v_item.name_ar, 1, v_item.price,
    0, 0, v_vat_rate, v_vat, v_taxable,
    case when v_vat_rate = 0 and v_item.vat_category = 'exempt' then v_taxable else 0 end,
    v_net, 'normal', 'manual', v_appointment_id, v_item.vat_category
  );

  return jsonb_build_object(
    'booking_reference', upper(substr(replace(v_appointment_id::text, '-', ''), 1, 8)),
    'appointment_id', v_appointment_id,
    'invoice_id', v_invoice_id,
    'scheduled_start', p_scheduled_start,
    'scheduled_end', v_scheduled_end,
    'service_name', v_item.name_ar,
    'doctor_name', v_doctor.name_ar,
    'clinic_name', v_clinic.name,
    'invoice_total', v_net,
    'currency', 'SAR'
  );
end;
$$;

revoke all on function public.app_public_booking_catalog(text) from public;
revoke all on function public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, boolean, text) from public;
grant execute on function public.app_public_booking_catalog(text) to anon, authenticated;
grant execute on function public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, boolean, text) to anon, authenticated;

insert into public.public_booking_settings (
  organization_id, public_slug, site_name, branch_id, hero_title, hero_subtitle,
  phone, address, is_enabled
)
select o.id, 'asnan-premium', 'مركز أسناني المميز الطبي', b.id,
       'ابتسامتك تبدأ برعاية تستحق الثقة',
       'خبرات متخصصة وتقنيات حديثة للعناية بصحة وجمال ابتسامتك في مكان واحد.',
       coalesce(b.phone, '920000000'),
       concat_ws('، ', b.address, b.city),
       true
  from public.organizations o
  join public.branches b on b.organization_id = o.id and b.is_main
 where o.name = 'مجمع زين الطبي'
on conflict (organization_id) do update set
  public_slug = excluded.public_slug,
  site_name = excluded.site_name,
  branch_id = excluded.branch_id,
  hero_title = excluded.hero_title,
  hero_subtitle = excluded.hero_subtitle,
  phone = excluded.phone,
  address = excluded.address,
  is_enabled = excluded.is_enabled,
  updated_at = now();


-- ==========================================================================
-- [14/21]  0129_public_booking_catalog_hardening.sql
--          تشديد كتالوج الحجز العام
-- ==========================================================================

create index if not exists idx_public_booking_settings_branch
  on public.public_booking_settings (branch_id);

create or replace function public.app_public_booking_catalog(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_result jsonb;
begin
  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;

  if v_setting.organization_id is null then
    raise exception 'موقع الحجز غير متاح';
  end if;

  select jsonb_build_object(
    'site_name', v_setting.site_name,
    'hero_title', v_setting.hero_title,
    'hero_subtitle', v_setting.hero_subtitle,
    'phone', v_setting.phone,
    'address', v_setting.address,
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
        from public.clinics c
       where c.organization_id = v_setting.organization_id
         and c.branch_id = v_setting.branch_id
         and c.allows_online_booking
         and not c.is_disabled
         and exists (
           select 1 from public.items i
            where i.organization_id = c.organization_id
              and i.default_clinic_id = c.id
              and i.item_type = 'service'
              and i.medical_service_type = 'dental'
              and not i.is_disabled
              and not i.is_archived
         )
    ), '[]'::jsonb),
    'doctors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name_ar,
        'job_title', d.job_title, 'clinic_id', d.clinic_id
      ) order by d.name_ar)
        from public.doctors d
       where d.organization_id = v_setting.organization_id
         and d.is_enabled
         and not d.disabled_from_booking
         and exists (
           select 1 from public.clinics c
            where c.id = d.clinic_id
              and c.organization_id = d.organization_id
              and c.branch_id = v_setting.branch_id
              and c.allows_online_booking
              and not c.is_disabled
              and exists (
                select 1 from public.items i
                 where i.organization_id = c.organization_id
                   and i.default_clinic_id = c.id
                   and i.item_type = 'service'
                   and i.medical_service_type = 'dental'
                   and not i.is_disabled
                   and not i.is_archived
              )
         )
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name_ar, 'description', i.description_ar,
        'price', i.price, 'duration_minutes', coalesce(i.duration_minutes, 30),
        'clinic_id', i.default_clinic_id
      ) order by i.name_ar)
        from public.items i
       where i.organization_id = v_setting.organization_id
         and i.item_type = 'service'
         and i.medical_service_type = 'dental'
         and not i.is_disabled
         and not i.is_archived
         and exists (
           select 1 from public.clinics c
            where c.id = i.default_clinic_id
              and c.organization_id = i.organization_id
              and c.branch_id = v_setting.branch_id
              and c.allows_online_booking
              and not c.is_disabled
         )
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.app_public_booking_catalog(text) from public;
grant execute on function public.app_public_booking_catalog(text) to anon, authenticated;


-- ==========================================================================
-- [15/21]  0130_public_booking_eligibility_guard.sql
--          حارس أهلية الحجز العام
-- ==========================================================================

create or replace function public.app_check_service_eligibility(
  p_item_id uuid,
  p_patient_id uuid,
  p_branch_id uuid default null,
  p_stage text default 'execution'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item items%rowtype;
  v_patient patients%rowtype;
  v_age integer;
  v_blocks text[] := '{}';
  v_warnings text[] := '{}';
  v_preauth insurance_preauthorizations%rowtype;
begin
  if p_stage not in ('booking','execution') then
    raise exception 'مرحلة غير معروفة: %', p_stage;
  end if;

  select * into v_item from items where id = p_item_id;
  if v_item.id is null then raise exception 'الخدمة غير موجودة'; end if;

  if not app_is_member(v_item.organization_id)
     and not (
       auth.role() = 'anon'
       and p_stage = 'booking'
       and v_item.item_type = 'service'
       and v_item.medical_service_type = 'dental'
       and exists (
         select 1
           from public.public_booking_settings s
          where s.organization_id = v_item.organization_id
            and s.is_enabled
       )
     ) then
    raise exception 'لا صلاحية';
  end if;

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

revoke all on function public.app_check_service_eligibility(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.app_check_service_eligibility(uuid, uuid, uuid, text)
  to authenticated;


-- ==========================================================================
-- [16/21]  0131_public_booking_doctor_availability.sql
--          إتاحة الأطباء للحجز العام
-- ==========================================================================

create or replace function public.app_check_doctor_availability(
  p_doctor_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor doctors%rowtype;
  v_block text;
  v_uncovered boolean;
  v_has_hours boolean;
  v_leave_end date;
begin
  select * into v_doctor from doctors where id = p_doctor_id;
  if v_doctor.id is null then return 'الطبيب غير موجود'; end if;

  if not app_is_member(v_doctor.organization_id)
     and not (
       auth.role() = 'anon'
       and exists (
         select 1
           from public.public_booking_settings s
           join public.clinics c
             on c.id = v_doctor.clinic_id
            and c.organization_id = s.organization_id
            and c.branch_id = s.branch_id
          where s.organization_id = v_doctor.organization_id
            and s.is_enabled
            and c.allows_online_booking
            and not c.is_disabled
       )
     ) then
    return 'لا صلاحية';
  end if;

  if not v_doctor.is_enabled then return 'الطبيب غير مفعَّل'; end if;
  if v_doctor.disabled_from_booking then return 'الطبيب موقوف عن استقبال الحجوزات'; end if;

  select case h.exception_type
           when 'leave' then 'الطبيب في إجازة'
           when 'vacation' then 'الطبيب في إجازة سنوية'
           when 'training' then 'الطبيب في تدريب'
           when 'emergency' then 'حالة طارئة مسجَّلة على وقت الطبيب'
           else 'الوقت المختار ضمن فترة عدم توفّر مسجَّلة للطبيب'
         end
    into v_block
    from doctor_working_hours h
   where h.doctor_id = p_doctor_id
     and h.is_blocked
     and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
   limit 1;

  if v_block is not null then return v_block; end if;

  select exists (
    select 1
      from generate_series(p_start::date, p_end::date, interval '1 day') g(d)
      cross join lateral app_doctor_working_ranges(p_doctor_id, g.d::date, null) r
  ) into v_has_hours;

  if v_has_hours then
    select not isempty(
             tstzmultirange(tstzrange(p_start, p_end, '[)'))
             - coalesce(range_agg(tstzrange(r.starts_at, r.ends_at, '[)')), tstzmultirange())
           )
      into v_uncovered
      from generate_series(p_start::date, p_end::date, interval '1 day') g(d)
      cross join lateral app_doctor_working_ranges(p_doctor_id, g.d::date, null) r;

    if coalesce(v_uncovered, true) then
      return 'الوقت المختار خارج دوام الطبيب المسجَّل';
    end if;
  end if;

  select l.end_date into v_leave_end
    from leave_requests l
    join employees e on e.id = l.employee_id
   where e.user_id = v_doctor.user_id
     and e.organization_id = v_doctor.organization_id
     and l.status = 'approved'
     and daterange(l.start_date, l.end_date, '[]')
         && daterange(p_start::date, p_end::date, '[]')
   order by l.end_date desc
   limit 1;

  if v_leave_end is not null then
    return format('الطبيب في إجازة معتمَدة حتى %s', to_char(v_leave_end, 'YYYY-MM-DD'));
  end if;

  return null;
end;
$$;

revoke all on function public.app_check_doctor_availability(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.app_check_doctor_availability(uuid, timestamptz, timestamptz)
  to authenticated;


-- ==========================================================================
-- [17/21]  0133_public_booking_tax_invoice.sql
--          الفاتورة الضريبية للحجز العام
-- ==========================================================================


create or replace function public.app_public_create_booking(
  p_slug text,
  p_name text,
  p_mobile text,
  p_email text,
  p_gender text,
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_item_id uuid,
  p_scheduled_start timestamptz,
  p_note text default null,
  p_consent boolean default false,
  p_website text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_mobile text := regexp_replace(coalesce(p_mobile, ''), '[^0-9+]', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_clinic public.clinics%rowtype;
  v_doctor public.doctors%rowtype;
  v_item public.items%rowtype;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_invoice_id uuid;
  v_invoice_number bigint;
  v_invoice_created_at timestamptz;
  v_duration integer;
  v_scheduled_end timestamptz;
  v_vat_rate numeric := 0;
  v_taxable numeric(14,2);
  v_vat numeric(14,2);
  v_net numeric(14,2);
  v_booking_key text;
  v_legal_name text;
  v_vat_registration_number text;
begin
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    raise exception 'تعذر إرسال الطلب';
  end if;

  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;

  if v_setting.organization_id is null then raise exception 'موقع الحجز غير متاح'; end if;
  if char_length(v_name) < 3 or char_length(v_name) > 120 then raise exception 'أدخل الاسم الكامل'; end if;
  if v_mobile !~ '^\+?[0-9]{8,15}$' then raise exception 'رقم الجوال غير صحيح'; end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'البريد الإلكتروني غير صحيح'; end if;
  if p_gender not in ('male', 'female') then raise exception 'اختر الجنس'; end if;
  if not coalesce(p_consent, false) then raise exception 'يجب الموافقة على استخدام البيانات لإتمام الحجز'; end if;
  if p_scheduled_start < now() + interval '1 hour' or p_scheduled_start > now() + interval '90 days' then
    raise exception 'اختر موعدًا خلال 90 يومًا وبفاصل ساعة على الأقل';
  end if;

  select * into v_clinic
    from public.clinics
   where id = p_clinic_id
     and organization_id = v_setting.organization_id
     and branch_id = v_setting.branch_id
     and allows_online_booking
     and not is_disabled;
  if v_clinic.id is null then raise exception 'العيادة غير متاحة للحجز الإلكتروني'; end if;

  select * into v_doctor
    from public.doctors
   where id = p_doctor_id
     and organization_id = v_setting.organization_id
     and clinic_id = v_clinic.id
     and is_enabled
     and not disabled_from_booking;
  if v_doctor.id is null then raise exception 'الطبيب غير متاح في العيادة المختارة'; end if;

  select * into v_item
    from public.items
   where id = p_item_id
     and organization_id = v_setting.organization_id
     and default_clinic_id = v_clinic.id
     and item_type = 'service'
     and medical_service_type = 'dental'
     and not is_disabled
     and not is_archived;
  if v_item.id is null then raise exception 'الخدمة غير متاحة للحجز الإلكتروني'; end if;

  v_duration := greatest(5, least(240, coalesce(v_item.duration_minutes, v_doctor.default_appointment_duration_minutes, v_clinic.default_visit_duration, 30)));
  v_scheduled_end := p_scheduled_start + make_interval(mins => v_duration);

  if exists (
    select 1 from public.appointments a
     where a.organization_id = v_setting.organization_id
       and a.doctor_id = v_doctor.id
       and a.status not in ('completed', 'no_show', 'cancelled_by_patient', 'cancelled_by_staff')
       and tstzrange(a.scheduled_start, a.scheduled_end, '[)') && tstzrange(p_scheduled_start, v_scheduled_end, '[)')
  ) then
    raise exception 'هذا الوقت محجوز، اختر وقتًا آخر';
  end if;

  v_booking_key := md5(v_setting.public_slug || ':' || v_mobile);
  if (
    select count(*) from public.public_booking_rate_limits
     where booking_key = v_booking_key
       and created_at > now() - interval '1 hour'
  ) >= 3 then
    raise exception 'تم إرسال عدة حجوزات لهذا الرقم؛ حاول لاحقًا';
  end if;
  insert into public.public_booking_rate_limits (booking_key) values (v_booking_key);

  if exists (
    select 1 from public.blocked_external_contacts b
     where b.organization_id = v_setting.organization_id
       and b.is_active
       and b.block_type in ('booking', 'all')
       and regexp_replace(coalesce(b.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
       and b.starts_at <= now()
       and (b.ends_at is null or b.ends_at > now())
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  select p.id into v_patient_id
    from public.patients p
   where p.organization_id = v_setting.organization_id
     and regexp_replace(coalesce(p.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
     and lower(regexp_replace(btrim(p.name_ar), '\s+', ' ', 'g')) = lower(v_name)
   order by p.created_at
   limit 1;

  if v_patient_id is not null and exists (
    select 1 from public.patients p where p.id = v_patient_id and p.block_appointments
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  if v_patient_id is null then
    insert into public.patients (
      organization_id, branch_id, name_ar, mobile_number, email_1, gender,
      preferred_language, treating_doctor_id, source_details, block_sms, block_sms_reason
    ) values (
      v_setting.organization_id, v_setting.branch_id, v_name, v_mobile, v_email,
      p_gender, 'ar', v_doctor.id, 'الموقع الإلكتروني', true, 'إرسال الرسائل الخارجية مؤجل'
    ) returning id into v_patient_id;
  end if;

  insert into public.appointments (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, item_id,
    scheduled_start, scheduled_end, status, priority, note
  ) values (
    v_setting.organization_id, v_setting.branch_id, v_clinic.id, v_doctor.id,
    v_patient_id, v_item.id, p_scheduled_start, v_scheduled_end, 'new', 'normal',
    concat_ws(E'\n', 'حجز من الموقع الإلكتروني', nullif(btrim(coalesce(p_note, '')), ''))
  ) returning id into v_appointment_id;

  select case
           when i.is_vat_exempt or i.vat_category in ('zero_rated', 'exempt', 'out_of_scope') then 0
           when not coalesce(s.sales_vat_enabled, true) then 0
           else coalesce(i.vat_rate_override, o.default_vat_rate, 0)
         end,
         coalesce(s.legal_name_ar, o.name),
         s.vat_registration_number
    into v_vat_rate, v_legal_name, v_vat_registration_number
    from public.items i
    join public.organizations o on o.id = i.organization_id
    left join public.organization_vat_settings s on s.organization_id = i.organization_id
   where i.id = v_item.id;

  v_taxable := round(v_item.price, 2);
  v_vat := round(v_taxable * v_vat_rate / 100.0, 2);
  v_net := v_taxable + v_vat;

  insert into public.sales_invoices (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, appointment_id,
    invoice_type, status, document_type, subtotal_amount, vat_amount, net_amount,
    paid_amount, patient_share_amount, note
  ) values (
    v_setting.organization_id, v_setting.branch_id, v_clinic.id, v_doctor.id,
    v_patient_id, v_appointment_id, 'sale', 'draft', 'simplified',
    v_taxable, v_vat, v_net, 0, v_net, 'فاتورة ضريبية مرتبطة بحجز الموقع الإلكتروني'
  ) returning id, invoice_number, created_at
    into v_invoice_id, v_invoice_number, v_invoice_created_at;

  insert into public.sales_invoice_items (
    invoice_id, organization_id, branch_id, patient_id, item_id, doctor_id,
    description, item_name_snapshot, qty, price, discount_percent,
    discount_amount, vat_rate, vat_amount, taxable_base, exemption_amount,
    net_amount, line_type, source_type, source_id, vat_category
  ) values (
    v_invoice_id, v_setting.organization_id, v_setting.branch_id, v_patient_id,
    v_item.id, v_doctor.id, v_item.name_ar, v_item.name_ar, 1, v_item.price,
    0, 0, v_vat_rate, v_vat, v_taxable,
    case when v_vat_rate = 0 and v_item.vat_category = 'exempt' then v_taxable else 0 end,
    v_net, 'normal', 'manual', v_appointment_id, v_item.vat_category
  );

  update public.sales_invoices
     set status = 'unpaid', issued_at = now(), updated_at = now()
   where id = v_invoice_id;

  return jsonb_build_object(
    'booking_reference', upper(substr(replace(v_appointment_id::text, '-', ''), 1, 8)),
    'invoice_number', v_invoice_number,
    'invoice_date', v_invoice_created_at,
    'scheduled_start', p_scheduled_start,
    'scheduled_end', v_scheduled_end,
    'patient_name', v_name,
    'patient_mobile', v_mobile,
    'patient_email', v_email,
    'service_name', v_item.name_ar,
    'doctor_name', v_doctor.name_ar,
    'clinic_name', v_clinic.name,
    'invoice_subtotal', v_taxable,
    'vat_rate', v_vat_rate,
    'vat_amount', v_vat,
    'invoice_total', v_net,
    'legal_name', v_legal_name,
    'vat_registration_number', v_vat_registration_number,
    'currency', 'SAR'
  );
end;
$$;

revoke all on function public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, boolean, text) from public;
grant execute on function public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, boolean, text) to anon, authenticated;


-- ==========================================================================
-- [18/21]  0134_public_booking_payment_options.sql
--          خيارات الدفع في الحجز العام
-- ==========================================================================


drop function if exists public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, boolean, text);

-- `create` وحدها تفشل عند الإعادة: السطر أعلاه يُسقط التوقيع **القديم** فقط،
-- أمّا التوقيع الجديد فيبقى قائمًا من التشغيلة السابقة.
create or replace function public.app_public_create_booking(
  p_slug text,
  p_name text,
  p_mobile text,
  p_email text,
  p_gender text,
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_item_id uuid,
  p_scheduled_start timestamptz,
  p_payment_method text,
  p_note text default null,
  p_consent boolean default false,
  p_website text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_mobile text := regexp_replace(coalesce(p_mobile, ''), '[^0-9+]', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_clinic public.clinics%rowtype;
  v_doctor public.doctors%rowtype;
  v_item public.items%rowtype;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_invoice_id uuid;
  v_invoice_number bigint;
  v_invoice_created_at timestamptz;
  v_duration integer;
  v_scheduled_end timestamptz;
  v_vat_rate numeric := 0;
  v_taxable numeric(14,2);
  v_vat numeric(14,2);
  v_net numeric(14,2);
  v_booking_key text;
  v_legal_name text;
  v_vat_registration_number text;
  v_payment_method_id uuid;
  v_voucher_id uuid;
begin
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    raise exception 'تعذر إرسال الطلب';
  end if;

  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;

  if v_setting.organization_id is null then raise exception 'موقع الحجز غير متاح'; end if;
  if char_length(v_name) < 3 or char_length(v_name) > 120 then raise exception 'أدخل الاسم الكامل'; end if;
  if v_mobile !~ '^\+?[0-9]{8,15}$' then raise exception 'رقم الجوال غير صحيح'; end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'البريد الإلكتروني غير صحيح'; end if;
  if p_gender not in ('male', 'female') then raise exception 'اختر الجنس'; end if;
  if p_payment_method not in ('test_card', 'cash_at_center') then raise exception 'اختر طريقة الدفع'; end if;
  if not coalesce(p_consent, false) then raise exception 'يجب الموافقة على استخدام البيانات لإتمام الحجز'; end if;
  if p_scheduled_start < now() + interval '1 hour' or p_scheduled_start > now() + interval '90 days' then
    raise exception 'اختر موعدًا خلال 90 يومًا وبفاصل ساعة على الأقل';
  end if;

  select * into v_clinic
    from public.clinics
   where id = p_clinic_id
     and organization_id = v_setting.organization_id
     and branch_id = v_setting.branch_id
     and allows_online_booking
     and not is_disabled;
  if v_clinic.id is null then raise exception 'العيادة غير متاحة للحجز الإلكتروني'; end if;

  select * into v_doctor
    from public.doctors
   where id = p_doctor_id
     and organization_id = v_setting.organization_id
     and clinic_id = v_clinic.id
     and is_enabled
     and not disabled_from_booking;
  if v_doctor.id is null then raise exception 'الطبيب غير متاح في العيادة المختارة'; end if;

  select * into v_item
    from public.items
   where id = p_item_id
     and organization_id = v_setting.organization_id
     and default_clinic_id = v_clinic.id
     and item_type = 'service'
     and medical_service_type = 'dental'
     and not is_disabled
     and not is_archived;
  if v_item.id is null then raise exception 'الخدمة غير متاحة للحجز الإلكتروني'; end if;

  v_duration := greatest(5, least(240, coalesce(v_item.duration_minutes, v_doctor.default_appointment_duration_minutes, v_clinic.default_visit_duration, 30)));
  v_scheduled_end := p_scheduled_start + make_interval(mins => v_duration);

  if exists (
    select 1 from public.appointments a
     where a.organization_id = v_setting.organization_id
       and a.doctor_id = v_doctor.id
       and a.status not in ('completed', 'no_show', 'cancelled_by_patient', 'cancelled_by_staff')
       and tstzrange(a.scheduled_start, a.scheduled_end, '[)') && tstzrange(p_scheduled_start, v_scheduled_end, '[)')
  ) then
    raise exception 'هذا الوقت محجوز، اختر وقتًا آخر';
  end if;

  v_booking_key := md5(v_setting.public_slug || ':' || v_mobile);
  if (
    select count(*) from public.public_booking_rate_limits
     where booking_key = v_booking_key
       and created_at > now() - interval '1 hour'
  ) >= 3 then
    raise exception 'تم إرسال عدة حجوزات لهذا الرقم؛ حاول لاحقًا';
  end if;
  insert into public.public_booking_rate_limits (booking_key) values (v_booking_key);

  if exists (
    select 1 from public.blocked_external_contacts b
     where b.organization_id = v_setting.organization_id
       and b.is_active
       and b.block_type in ('booking', 'all')
       and regexp_replace(coalesce(b.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
       and b.starts_at <= now()
       and (b.ends_at is null or b.ends_at > now())
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  select p.id into v_patient_id
    from public.patients p
   where p.organization_id = v_setting.organization_id
     and regexp_replace(coalesce(p.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
     and lower(regexp_replace(btrim(p.name_ar), '\s+', ' ', 'g')) = lower(v_name)
   order by p.created_at
   limit 1;

  if v_patient_id is not null and exists (
    select 1 from public.patients p where p.id = v_patient_id and p.block_appointments
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  if v_patient_id is null then
    insert into public.patients (
      organization_id, branch_id, name_ar, mobile_number, email_1, gender,
      preferred_language, treating_doctor_id, source_details, block_sms, block_sms_reason
    ) values (
      v_setting.organization_id, v_setting.branch_id, v_name, v_mobile, v_email,
      p_gender, 'ar', v_doctor.id, 'الموقع الإلكتروني', true, 'إرسال الرسائل الخارجية مؤجل'
    ) returning id into v_patient_id;
  end if;

  insert into public.appointments (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, item_id,
    scheduled_start, scheduled_end, status, priority, note
  ) values (
    v_setting.organization_id, v_setting.branch_id, v_clinic.id, v_doctor.id,
    v_patient_id, v_item.id, p_scheduled_start, v_scheduled_end, 'new', 'normal',
    concat_ws(E'\n', 'حجز من الموقع الإلكتروني', nullif(btrim(coalesce(p_note, '')), ''))
  ) returning id into v_appointment_id;

  select case
           when i.is_vat_exempt or i.vat_category in ('zero_rated', 'exempt', 'out_of_scope') then 0
           when not coalesce(s.sales_vat_enabled, true) then 0
           else coalesce(i.vat_rate_override, o.default_vat_rate, 0)
         end,
         coalesce(s.legal_name_ar, o.name),
         s.vat_registration_number
    into v_vat_rate, v_legal_name, v_vat_registration_number
    from public.items i
    join public.organizations o on o.id = i.organization_id
    left join public.organization_vat_settings s on s.organization_id = i.organization_id
   where i.id = v_item.id;

  v_taxable := round(v_item.price, 2);
  v_vat := round(v_taxable * v_vat_rate / 100.0, 2);
  v_net := v_taxable + v_vat;

  insert into public.sales_invoices (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, appointment_id,
    invoice_type, status, document_type, subtotal_amount, vat_amount, net_amount,
    paid_amount, patient_share_amount, note
  ) values (
    v_setting.organization_id, v_setting.branch_id, v_clinic.id, v_doctor.id,
    v_patient_id, v_appointment_id, 'sale', 'draft', 'simplified',
    v_taxable, v_vat, v_net, 0, v_net, 'فاتورة ضريبية مرتبطة بحجز الموقع الإلكتروني'
  ) returning id, invoice_number, created_at
    into v_invoice_id, v_invoice_number, v_invoice_created_at;

  insert into public.sales_invoice_items (
    invoice_id, organization_id, branch_id, patient_id, item_id, doctor_id,
    description, item_name_snapshot, qty, price, discount_percent,
    discount_amount, vat_rate, vat_amount, taxable_base, exemption_amount,
    net_amount, line_type, source_type, source_id, vat_category
  ) values (
    v_invoice_id, v_setting.organization_id, v_setting.branch_id, v_patient_id,
    v_item.id, v_doctor.id, v_item.name_ar, v_item.name_ar, 1, v_item.price,
    0, 0, v_vat_rate, v_vat, v_taxable,
    case when v_vat_rate = 0 and v_item.vat_category = 'exempt' then v_taxable else 0 end,
    v_net, 'normal', 'manual', v_appointment_id, v_item.vat_category
  );

  update public.sales_invoices
     set status = 'unpaid', issued_at = now(), updated_at = now()
   where id = v_invoice_id;

  if p_payment_method = 'test_card' then
    select lv.id into v_payment_method_id
      from public.lookup_values lv
      join public.lookup_categories lc on lc.id = lv.category_id
     where lc.key = 'payment_methods'
       and lv.code = 'online'
     order by lv.sort_order
     limit 1;

    if v_payment_method_id is null then
      raise exception 'طريقة الدفع الإلكتروني غير مهيأة';
    end if;

    insert into public.financial_vouchers (
      organization_id, branch_id, voucher_type, voucher_date, amount,
      payment_method_value_id, bank_transfer_ref, related_sales_invoice_id,
      patient_id, clinic_id, doctor_id, description
    ) values (
      v_setting.organization_id, v_setting.branch_id, 'receipt', current_date, v_net,
      v_payment_method_id,
      'TEST-' || upper(substr(replace(v_appointment_id::text, '-', ''), 1, 8)),
      v_invoice_id, v_patient_id, v_clinic.id, v_doctor.id,
      'دفعة بطاقة تجريبية من موقع الحجز'
    ) returning id into v_voucher_id;

    insert into public.voucher_invoice_allocations (voucher_id, sales_invoice_id, amount)
    values (v_voucher_id, v_invoice_id, v_net);

    perform public.app_recalc_invoice_paid_amount(v_invoice_id);
  end if;

  return jsonb_build_object(
    'booking_reference', upper(substr(replace(v_appointment_id::text, '-', ''), 1, 8)),
    'invoice_number', v_invoice_number,
    'invoice_date', v_invoice_created_at,
    'scheduled_start', p_scheduled_start,
    'scheduled_end', v_scheduled_end,
    'patient_name', v_name,
    'patient_mobile', v_mobile,
    'patient_email', v_email,
    'service_name', v_item.name_ar,
    'doctor_name', v_doctor.name_ar,
    'clinic_name', v_clinic.name,
    'invoice_subtotal', v_taxable,
    'vat_rate', v_vat_rate,
    'vat_amount', v_vat,
    'invoice_total', v_net,
    'paid_amount', case when p_payment_method = 'test_card' then v_net else 0 end,
    'remaining_amount', case when p_payment_method = 'test_card' then 0 else v_net end,
    'invoice_status', case when p_payment_method = 'test_card' then 'paid' else 'unpaid' end,
    'payment_method', p_payment_method,
    'legal_name', v_legal_name,
    'vat_registration_number', v_vat_registration_number,
    'currency', 'SAR'
  );
end;
$$;

revoke all on function public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, text, boolean, text) from public;
grant execute on function public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, text, boolean, text) to anon, authenticated;


-- ==========================================================================
-- [19/21]  0135_flexible_doctor_schedules_and_public_slots.sql
--          جداول الأطباء المرنة والمواعيد المتاحة
-- ==========================================================================


alter table public.doctor_schedules
  add column if not exists recurrence_type text not null default 'weekly',
  add column if not exists pattern_anchor_date date;

alter table public.doctor_schedules
  drop constraint if exists doctor_schedules_recurrence_check;
alter table public.doctor_schedules
  add constraint doctor_schedules_recurrence_check
  check (
    recurrence_type in ('weekly', 'alternate_days')
    and (recurrence_type = 'weekly' or pattern_anchor_date is not null)
  );

create or replace function public.app_doctor_working_ranges(
  p_doctor_id uuid,
  p_date date,
  p_clinic_id uuid default null
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  clinic_id uuid,
  slot_duration_minutes int,
  capacity int,
  source text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with custom as (
    select h.starts_at, h.ends_at, h.clinic_id,
           null::int as slot_duration_minutes, 1 as capacity, 'exception'::text as source
      from public.doctor_working_hours h
     where h.doctor_id = p_doctor_id
       and h.exception_type = 'custom_hours'
       and h.starts_at::date <= p_date
       and h.ends_at::date >= p_date
       and (p_clinic_id is null or h.clinic_id is null or h.clinic_id = p_clinic_id)
  ),
  recurring as (
    select (p_date + s.start_time)::timestamptz as starts_at,
           (p_date + s.end_time)::timestamptz as ends_at,
           s.clinic_id,
           s.slot_duration_minutes,
           s.capacity,
           case s.recurrence_type
             when 'alternate_days' then 'alternate_days'
             else 'schedule'
           end::text as source
      from public.doctor_schedules s
     where s.doctor_id = p_doctor_id
       and s.is_active
       and s.effective_from <= p_date
       and (s.effective_to is null or s.effective_to >= p_date)
       and (p_clinic_id is null or s.clinic_id is null or s.clinic_id = p_clinic_id)
       and (
         (s.recurrence_type = 'weekly' and s.day_of_week = extract(isodow from p_date)::int)
         or (
           s.recurrence_type = 'alternate_days'
           and p_date >= s.pattern_anchor_date
           and mod(p_date - s.pattern_anchor_date, 2) = 0
         )
       )
  )
  select * from custom
  union all
  select * from recurring where not exists (select 1 from custom);
$$;

revoke all on function public.app_doctor_working_ranges(uuid, date, uuid) from public, anon;
grant execute on function public.app_doctor_working_ranges(uuid, date, uuid) to authenticated;

create or replace function public.app_doctor_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_clinic_id uuid default null,
  p_duration int default null
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  clinic_id uuid,
  capacity int,
  booked int,
  is_free boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.doctors where id = p_doctor_id;
  if v_org is null then return; end if;

  if not public.app_is_member(v_org)
     and not (
       auth.role() = 'anon'
       and exists (
         select 1
           from public.public_booking_settings setting
           join public.clinics clinic
             on clinic.id = p_clinic_id
            and clinic.organization_id = setting.organization_id
            and clinic.branch_id = setting.branch_id
          where setting.organization_id = v_org
            and setting.is_enabled
            and clinic.allows_online_booking
            and not clinic.is_disabled
       )
     ) then
    return;
  end if;

  return query
  with ranges as (
    select * from public.app_doctor_working_ranges(p_doctor_id, p_date, p_clinic_id)
  ),
  slots as (
    select
      generated.slot_start,
      generated.slot_start + make_interval(mins => coalesce(p_duration, range.slot_duration_minutes, 15)) as slot_end,
      range.clinic_id,
      range.capacity
    from ranges range
    cross join lateral generate_series(
      range.starts_at,
      range.ends_at - make_interval(mins => coalesce(p_duration, range.slot_duration_minutes, 15)),
      make_interval(mins => coalesce(p_duration, range.slot_duration_minutes, 15))
    ) generated(slot_start)
  )
  select
    slot.slot_start,
    slot.slot_end,
    slot.clinic_id,
    slot.capacity,
    coalesce(appointment_count.taken, 0)::int,
    coalesce(appointment_count.taken, 0) < slot.capacity and block.reason is null,
    block.reason
  from slots slot
  left join lateral (
    select count(*)::int as taken
      from public.appointments appointment
     where appointment.doctor_id = p_doctor_id
       and appointment.status not in ('cancelled_by_patient', 'cancelled_by_staff', 'no_show')
       and tstzrange(appointment.scheduled_start, appointment.scheduled_end, '[)')
           && tstzrange(slot.slot_start, slot.slot_end, '[)')
  ) appointment_count on true
  left join lateral (
    select case hours.exception_type
             when 'leave' then 'إجازة'
             when 'vacation' then 'إجازة سنوية'
             when 'training' then 'تدريب'
             when 'emergency' then 'طارئ'
             else 'محجوب'
           end as reason
      from public.doctor_working_hours hours
     where hours.doctor_id = p_doctor_id
       and hours.is_blocked
       and tstzrange(hours.starts_at, hours.ends_at, '[)')
           && tstzrange(slot.slot_start, slot.slot_end, '[)')
     limit 1
  ) block on true
  order by slot.slot_start;
end;
$$;

revoke all on function public.app_doctor_available_slots(uuid, date, uuid, int) from public, anon;
grant execute on function public.app_doctor_available_slots(uuid, date, uuid, int) to authenticated;

create or replace function public.app_check_doctor_availability(
  p_doctor_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor public.doctors%rowtype;
  v_block text;
  v_uncovered boolean;
  v_has_hours boolean;
  v_has_schedule boolean;
  v_leave_end date;
begin
  select * into v_doctor from public.doctors where id = p_doctor_id;
  if v_doctor.id is null then return 'الطبيب غير موجود'; end if;

  if not public.app_is_member(v_doctor.organization_id)
     and not (
       auth.role() = 'anon'
       and exists (
         select 1
           from public.public_booking_settings setting
           join public.clinics clinic
             on clinic.id = v_doctor.clinic_id
            and clinic.organization_id = setting.organization_id
            and clinic.branch_id = setting.branch_id
          where setting.organization_id = v_doctor.organization_id
            and setting.is_enabled
            and clinic.allows_online_booking
            and not clinic.is_disabled
       )
     ) then
    return 'لا صلاحية';
  end if;

  if not v_doctor.is_enabled then return 'الطبيب غير مفعَّل'; end if;
  if v_doctor.disabled_from_booking then return 'الطبيب موقوف عن استقبال الحجوزات'; end if;

  select case hours.exception_type
           when 'leave' then 'الطبيب في إجازة'
           when 'vacation' then 'الطبيب في إجازة سنوية'
           when 'training' then 'الطبيب في تدريب'
           when 'emergency' then 'حالة طارئة مسجَّلة على وقت الطبيب'
           else 'الوقت المختار ضمن فترة عدم توفّر مسجَّلة للطبيب'
         end
    into v_block
    from public.doctor_working_hours hours
   where hours.doctor_id = p_doctor_id
     and hours.is_blocked
     and tstzrange(hours.starts_at, hours.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
   limit 1;

  if v_block is not null then return v_block; end if;

  select exists (
    select 1
      from generate_series(p_start::date, p_end::date, interval '1 day') generated(day)
      cross join lateral public.app_doctor_working_ranges(p_doctor_id, generated.day::date, null) range
  ) into v_has_hours;

  select exists (
    select 1 from public.doctor_schedules schedule
     where schedule.doctor_id = p_doctor_id
       and schedule.is_active
       and schedule.effective_from <= p_start::date
       and (schedule.effective_to is null or schedule.effective_to >= p_start::date)
  ) into v_has_schedule;

  if v_has_schedule and not v_has_hours then
    return 'الطبيب لا يعمل في اليوم المختار';
  end if;

  if v_has_hours then
    select not isempty(
             tstzmultirange(tstzrange(p_start, p_end, '[)'))
             - coalesce(range_agg(tstzrange(range.starts_at, range.ends_at, '[)')), tstzmultirange())
           )
      into v_uncovered
      from generate_series(p_start::date, p_end::date, interval '1 day') generated(day)
      cross join lateral public.app_doctor_working_ranges(p_doctor_id, generated.day::date, null) range;

    if coalesce(v_uncovered, true) then return 'الوقت المختار خارج دوام الطبيب المسجَّل'; end if;
  end if;

  select request.end_date into v_leave_end
    from public.leave_requests request
    join public.employees employee on employee.id = request.employee_id
   where employee.user_id = v_doctor.user_id
     and employee.organization_id = v_doctor.organization_id
     and request.status = 'approved'
     and daterange(request.start_date, request.end_date, '[]')
         && daterange(p_start::date, p_end::date, '[]')
   order by request.end_date desc
   limit 1;

  if v_leave_end is not null then
    return format('الطبيب في إجازة معتمَدة حتى %s', to_char(v_leave_end, 'YYYY-MM-DD'));
  end if;

  return null;
end;
$$;

revoke all on function public.app_check_doctor_availability(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.app_check_doctor_availability(uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.app_public_doctor_slots(
  p_slug text,
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_item_id uuid,
  p_from date default current_date,
  p_days int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_duration int;
  v_result jsonb;
begin
  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;
  if v_setting.organization_id is null then raise exception 'موقع الحجز غير متاح'; end if;

  select coalesce(item.duration_minutes, doctor.default_appointment_duration_minutes, clinic.default_visit_duration, 30)
    into v_duration
    from public.doctors doctor
    join public.clinics clinic
      on clinic.id = p_clinic_id
     and clinic.organization_id = doctor.organization_id
     and clinic.branch_id = v_setting.branch_id
     and clinic.allows_online_booking
     and not clinic.is_disabled
    join public.items item
      on item.id = p_item_id
     and item.organization_id = doctor.organization_id
     and item.default_clinic_id = clinic.id
     and item.item_type = 'service'
     and item.medical_service_type = 'dental'
     and not item.is_disabled
     and not item.is_archived
   where doctor.id = p_doctor_id
     and doctor.organization_id = v_setting.organization_id
     and doctor.clinic_id = clinic.id
     and doctor.is_enabled
     and not doctor.disabled_from_booking;

  if v_duration is null then raise exception 'الطبيب أو الخدمة غير متاحين للحجز'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'start', available.slot_start,
           'end', available.slot_end,
           'date', to_char(available.slot_start, 'YYYY-MM-DD')
         ) order by available.slot_start), '[]'::jsonb)
    into v_result
    from generate_series(
      greatest(p_from, current_date),
      greatest(p_from, current_date) + least(greatest(coalesce(p_days, 30), 1), 60) - 1,
      interval '1 day'
    ) generated(day)
    cross join lateral public.app_doctor_available_slots(
      p_doctor_id,
      generated.day::date,
      p_clinic_id,
      v_duration
    ) available
   where available.is_free
     and available.slot_start >= now() + interval '1 hour';

  return jsonb_build_object('duration_minutes', v_duration, 'slots', v_result);
end;
$$;

revoke all on function public.app_public_doctor_slots(text, uuid, uuid, uuid, date, int) from public;
grant execute on function public.app_public_doctor_slots(text, uuid, uuid, uuid, date, int) to anon, authenticated;


-- ==========================================================================
-- [20/21]  0136_public_booking_advisor_exception.sql
--          استثناء الحجز العام من إنذار anon (إصلاحي)
-- ==========================================================================

-- ============================================================================
-- 0136 — استثناء موقع الحجز العام من إنذار «دالّة مفتوحة أمام anon»
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   `v_security_advisor` (0095) يرفع «خطر» لكل دالّة SECURITY DEFINER يستطيع
--   `anon` تنفيذها — وهي قاعدة صحيحة: دالّةٌ كهذه تتخطّى RLS بلا مستخدم.
--
--   لكن موقع الحجز العام (0128–0135) يقوم على أن **الزائر يحجز بلا حساب**،
--   فثلاث دوالّ لا بدّ أن تكون مفتوحة أمام `anon`:
--     • `app_public_booking_catalog` — كتالوج معلن، محصور في 0129
--     • `app_public_doctor_slots`    — المواعيد المتاحة فقط
--     • `app_public_create_booking`  — إنشاء الحجز، محكوم بحارس الأهلية 0130
--
--   فبقاؤها في قائمة «خطر» يعني ثلاثة إنذارات دائمة لا تُغلق أبدًا. وشاشة
--   أمانٍ تصرخ بما لا يُصلَح يتعلّم صاحبها تجاهلها — وعندها يضيع الإنذار
--   الحقيقي حين يأتي. الإنذار الذي لا يُغلق أسوأ من غيابه.
--
-- ما يفعله هذا الملف: يستثني هذه الثلاث **وحدها بالاسم**. أي دالّة رابعة
-- تُفتح أمام `anon` — عمدًا أو سهوًا — ترتفع في المستشار فورًا كما كانت.
-- القائمة مغلقة، لا قاعدة عامة تُسكِت الفحص.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.**
-- ============================================================================

do $zc_pre$
begin
  if to_regclass('public.v_security_advisor') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0136: `v_security_advisor` غير موجود — شغّل 0095_security_audit_pdpl.sql أوّلًا.';
  end if;
  if to_regclass('public.public_booking_settings') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0136: موقع الحجز العام غير مُنشأ — شغّل 0128_public_booking_website.sql أوّلًا.';
  end if;
end
$zc_pre$;

create or replace function app_is_public_booking_endpoint(p_proname text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_proname in ('app_public_booking_catalog',
                       'app_public_doctor_slots',
                       'app_public_create_booking');
$$;

comment on function app_is_public_booking_endpoint(text) is
  'قائمة مغلقة بدوالّ موقع الحجز العام المسموح لـ anon باستدعائها. أي اسم خارجها يبقى «خطر» في مستشار الأمان.';

revoke all on function app_is_public_booking_endpoint(text) from public, anon;
grant execute on function app_is_public_booking_endpoint(text) to authenticated, service_role;

-- إعادة بناء المستشار بالبند المستثنى وحده؛ بقيّة البنود كما هي.
do $zc_rebuild$
declare
  v_def text;
  v_new text;
begin
  select pg_get_viewdef('public.v_security_advisor'::regclass, true) into v_def;
  v_def := replace(v_def, chr(13), '');

  if v_def like '%app_is_public_booking_endpoint%' then
    return;  -- مُستثنى سلفًا
  end if;

  -- البند المقصود هو الوحيد الذي يجمع `prosecdef` مع صلاحية anon.
  v_new := replace(
    v_def,
    'has_function_privilege(''anon''::name, p.oid, ''execute''::text)',
    'has_function_privilege(''anon''::name, p.oid, ''execute''::text) '
    'AND NOT app_is_public_booking_endpoint(p.proname::text)');

  if v_new = v_def then
    raise exception 'تعذّر استثناء دوالّ الحجز العام: شكل `v_security_advisor` تغيّر — راجع 0095 و0136';
  end if;

  execute 'create or replace view v_security_advisor as ' || v_new;
end
$zc_rebuild$;

alter view v_security_advisor set (security_invoker = on);

-- ── تحقّق فوريّ ─────────────────────────────────────────────────────────────
-- لا يكفي أن يُنشأ المنظور: يجب أن تكون الثلاث قد اختفت فعلًا من «خطر»،
-- وأن يبقى الفحص قادرًا على رفع أي دالّة أخرى.
do $zc_verify$
declare
  v_left int;
begin
  select count(*) into v_left
    from v_security_advisor
   where finding_type = 'definer_anon_execute'
     and object_name in ('app_public_booking_catalog',
                         'app_public_doctor_slots',
                         'app_public_create_booking');
  if v_left > 0 then
    raise exception 'الاستثناء لم يُطبَّق: ما زالت % من دوالّ الحجز العام في قائمة الخطر', v_left;
  end if;

  if pg_get_viewdef('public.v_security_advisor'::regclass, true)
       not like '%app_is_public_booking_endpoint%' then
    raise exception 'المنظور لم يُعد بناؤه بالاستثناء';
  end if;
end
$zc_verify$;


-- ==========================================================================
-- [21/21]  0137_restore_ui_function_grants.sql
--          إعادة صلاحيات الواجهة + سدّ ثغرة دليل الحسابات (إصلاحي)
-- ==========================================================================

-- ============================================================================
-- 0137 — إعادة الصلاحيات التي تحتاجها الواجهة، بعد تأمين ما كان مفتوحًا
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   `0114` سحبت `execute` من `public` عن **كل** دالّة تبدأ بـ`app_`. وهذه
--   خطوة صحيحة في أصلها، لكن `authenticated` كان يرث التنفيذ عبر `public`،
--   فكل دالّة لم تُمنح له صراحةً صارت محجوبة عنه. أربع منها تحتاجها الواجهة
--   فعلًا، فانكسرت بصمت — «permission denied for function …» عند المستخدم:
--
--     • `app_mask_text`       — يستعمله `v_patient_directory`، والعرض
--                               `security_invoker` أي يقرأ بصلاحية المستخدم.
--                               النتيجة: **دليل المرضى لا يفتح**.
--     • `app_country_defaults`— يستعمله عرض إعدادات اللغة، وبالمثل.
--     • `app_seed_default_chart_of_accounts` و`app_seed_gl_posting_rules` —
--       تستدعيهما شاشة المحاسبة بـ`rpc` مباشرة. بلا صلاحية = **زرّان لا
--       يعملان**، وهو ما اشترطتَ ألّا يوجد.
--
--   لكن الإعادة المجرَّدة خطأ أكبر: `app_seed_default_chart_of_accounts`
--   دالّة `SECURITY DEFINER` **بلا أيّ تحقّق من العضوية**، تأخذ معرّف منشأة
--   وتكتب فيه. منحها لـ`authenticated` كما هي يعني أن أيّ مستخدم مسجَّل في
--   أيّ منشأة يستطيع تهيئة دليل حسابات **منشأة غيره** بتمرير معرّفها. لذلك
--   حُجبت في 0123 — والحجب عالج الثغرة وكسر الزر معًا.
--
--   الحلّ هنا: يُسدّ الثقب أوّلًا بحارس صلاحية داخل الدالّة، ثم تُعاد
--   الصلاحية. لا زرّ معطَّل، ولا منشأة مكشوفة.
--
-- بقيّة ما سحبته 0114 و0123 يبقى محجوبًا عن الواجهة: دوالّ البذر التلقائي
-- ودوالّ المهام الخلفية (`app_notify`, `app_claim_pending_messages`,
-- `app_mark_message_*`, `app_process_due_appointment_reminders` …) تُستدعى من
-- المحفِّزات أو من `service_role`، ولا تُنادى من المتصفّح أصلًا.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.**
-- ============================================================================

do $zc_pre$
begin
  if to_regprocedure('public.app_has_permission(uuid,text)') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0137: `app_has_permission` غير موجودة — شغّل هجرات الصلاحيات أوّلًا.';
  end if;
end
$zc_pre$;

-- ── 1) سدّ الثقب: تهيئة دليل الحسابات تتحقّق من الصلاحية ───────────────────
-- نفس مفتاح الصلاحية الذي تستعمله `app_seed_gl_posting_rules` (`gl.rules`):
-- من يملك ضبط قواعد الترحيل هو من يملك تهيئة الدليل الافتراضي.
do $zc_guard$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_seed_default_chart_of_accounts';
  v_src := replace(v_src, chr(13), '');

  if v_src is null then
    raise exception 'app_seed_default_chart_of_accounts غير موجودة — شغّل 0017/0099 أوّلًا';
  end if;

  if position('gl.rules' in v_src) > 0 then
    return;  -- محروسة سلفًا
  end if;

  -- الحارس يُدرج مباشرةً بعد `begin` الأولى في جسم الدالّة.
  v_new := replace(
    v_src,
    E'AS $function$\nbegin\n',
    E'AS $function$\nbegin\n'
    '  if not app_has_permission(target_organization_id, ''gl.rules'') then\n'
    '    raise exception ''صلاحيتك لا تسمح بتهيئة دليل الحسابات (gl.rules)'';\n'
    '  end if;\n\n');

  if v_new = v_src then
    raise exception 'تعذّر إدراج حارس الصلاحية في app_seed_default_chart_of_accounts — راجع 0137';
  end if;

  execute v_new;
end
$zc_guard$;

-- ── 2) إعادة الصلاحيات للأربع، وللأربع وحدها ──────────────────────────────
do $zc_grant$
declare
  v_sig regprocedure;
begin
  for v_sig in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_mask_text',
                         'app_country_defaults',
                         'app_seed_default_chart_of_accounts',
                         'app_seed_gl_posting_rules')
  loop
    execute format('grant execute on function %s to authenticated', v_sig);
    -- `anon` يبقى محجوبًا: لا شيء من هذه الأربع يُنادى بلا تسجيل دخول.
    execute format('revoke all on function %s from anon, public', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end
$zc_grant$;

-- ── تحقّق فوريّ ─────────────────────────────────────────────────────────────
do $zc_verify$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_mask_text','app_country_defaults',
                       'app_seed_default_chart_of_accounts','app_seed_gl_posting_rules')
     and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'ما زالت محجوبة عن authenticated: %', v_bad;
  end if;

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_mask_text','app_country_defaults',
                       'app_seed_default_chart_of_accounts','app_seed_gl_posting_rules')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'مفتوحة أمام anon بلا داعٍ: %', v_bad;
  end if;

  if pg_get_functiondef('public.app_seed_default_chart_of_accounts(uuid)'::regprocedure)
       not like '%gl.rules%' then
    raise exception 'حارس الصلاحية لم يُثبَّت في تهيئة دليل الحسابات';
  end if;
end
$zc_verify$;


-- ==========================================================================
-- نهاية الجزء 3 (الجوهري 0113–0135) — 21 هجرة
-- ==========================================================================
do $zc_done$
begin
  raise notice '=== اكتمل % بنجاح ===', 'الجزء 3 (الجوهري 0113–0135)';
end
$zc_done$;
