-- ============================================================================
-- 0102 — المرحلة 22: إدارة المستندات والموافقات والتواقيع
-- ============================================================================
-- لماذا هذه المرحلة أصلًا؟ ثلاث ثغرات قائمة في النظام اليوم:
--
--   1) `items.requires_consent` موجود، و`v_pending_consents` يعرض الخدمات التي
--      تحتاج موافقة — لكن **لا شيء يمنع تنفيذ الخدمة بلا موافقة**. التقرير
--      يشتكي بعد وقوع الفعل. الموافقة الطبية إمّا أن تكون حارسًا أو لا تكون.
--   2) الفحص القائم يقبل *أيّ* مستند موافقة موقَّع للمريض ولو كان لإجراء آخر.
--      موافقة على خلع ضرس ليست موافقة على تخدير عام.
--   3) `patient_documents.signed_at` عمودٌ يُملأ يدويًّا بلا سجلّ **من وقّع**
--      ولا بأيّ صفة ولا بأيّ وسيلة. التوقيع بلا هوية موقِّع ليس توقيعًا.
--
-- ولا تُنشأ جداول مكرّرة: `patient_documents` و`employee_documents`
-- و`document_templates` و`generated_documents` و`patient_consents` كلّها قائمة
-- وتُوسَّع في مكانها. الجديد اثنان فقط: مستندات الكيانات الأخرى (أصول،
-- موردون، فواتير شراء…) وجدول التواقيع.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
--
-- ملاحظة تشغيلية: الملفات نفسها تبقى في حاوية Supabase Storage القائمة
-- `patient-documents` (المهاجرة 0037) — لا حاوية جديدة. سياستها تتحقّق أن
-- المستخدم عضوٌ في المنشأة التي يمثّلها أوّل جزء من المسار، فمستندات
-- الكيانات الأخرى تُكتب تحت `{organization_id}/entities/...` وتخضع للسياسة
-- نفسها. الجداول هنا تحفظ المسار لا الملف.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
-- ⟪PRECHECK-BEGIN⟫
-- ── تحقّق من المتطلبات السابقة ────────────────────────────────────────────
-- الهجرات تُنفَّذ بالترتيب الرقمي. لو نُفِّذ هذا الملف قبل ما يسبقه فالخطأ
-- الذي يظهر يكون غامضًا (42P01: relation ... does not exist) ولا يدلّ على
-- السبب. الكتلة التالية توقف التنفيذ فورًا برسالة تسمّي الملف الناقص.
-- لا تُغيّر شيئًا في القاعدة، وتُعاد بلا أثر.
do $zc_precheck$
declare
  v_missing text := '';
begin
  if to_regclass('public.payroll_runs') is null then
    v_missing := v_missing || E'\n  • 0100_hr_and_payroll.sql  (الموارد البشرية والرواتب)';
  end if;
  if to_regclass('public.assets') is null then
    v_missing := v_missing || E'\n  • 0101_assets_and_maintenance.sql  (الأصول والصيانة)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0102_documents_and_signatures.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('documents.view',      'عرض المستندات',            'documents', 1500),
  ('documents.upload',    'رفع المستندات',            'documents', 1502),
  ('documents.archive',   'أرشفة المستندات',          'documents', 1504),
  ('documents.templates', 'إدارة قوالب المستندات',    'documents', 1506),
  ('consents.sign',       'تسجيل الموافقات والتواقيع','documents', 1508),
  ('consents.override',   'تجاوز الموافقة بمبرّر',    'documents', 1510)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **تجاوز الموافقة لا يُمنح افتراضيًّا لأحد**: هو استثناء طبّي مسؤول، لا إعداد.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'documents.view'), ('branch_manager', 'documents.upload'),
  ('branch_manager', 'documents.archive'), ('branch_manager', 'documents.templates'),
  ('branch_manager', 'consents.sign'),
  ('doctor',         'documents.view'), ('doctor', 'documents.upload'),
  ('doctor',         'consents.sign'),
  ('nurse',          'documents.view'), ('nurse', 'documents.upload'),
  ('nurse',          'consents.sign'),
  ('receptionist',   'documents.view'), ('receptionist', 'documents.upload'),
  ('receptionist',   'consents.sign'),
  ('hr_manager',     'documents.view'), ('hr_manager', 'documents.upload'),
  ('accountant',     'documents.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) توسعة مستندات المريض — بلا جدول جديد
-- ===========================================================================
alter table patient_documents
  add column if not exists branch_id uuid references branches(id),
  add column if not exists item_id uuid references items(id),
  add column if not exists template_id uuid references document_templates(id),
  add column if not exists generated_document_id uuid references generated_documents(id),
  add column if not exists document_number bigint,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  -- لا أعمدة إصدار/استبدال هنا: النظام لا يبني تسلسل نسخٍ للمستند، والبديل
  -- العملي القائم هو أرشفة القديم بسبب ورفع الجديد. عمودٌ يَعِد بتسلسلٍ لا
  -- يكتبه أحد أسوأ من غيابه.
  add column if not exists signed_by uuid references auth.users(id),
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id),
  add column if not exists archive_reason text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_patient_documents_patient
  on patient_documents (organization_id, patient_id, is_archived);
create index if not exists idx_patient_documents_item
  on patient_documents (organization_id, item_id) where is_consent;

alter table employee_documents
  add column if not exists branch_id uuid references branches(id),
  add column if not exists uploaded_by uuid references auth.users(id),
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id),
  add column if not exists archive_reason text;

-- ===========================================================================
-- 3) مستندات الكيانات الأخرى — أصول، موردون، فواتير، تراخيص
--    (شهادة معايرة الجهاز، ضمان، عقد مورّد، رخصة منشأة…)
-- ===========================================================================
create table if not exists entity_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  entity_type      text not null
                     check (entity_type in ('asset','asset_calibration','maintenance_order',
                                            'distributor','purchase_invoice','purchase_order',
                                            'insurance_company','organization','branch','other')),
  entity_id        uuid not null,
  category         text,
  title            text not null,
  storage_path     text not null,
  file_name        text,
  mime_type        text,
  file_size_bytes  bigint,
  issue_date       date,
  expires_at       date,
  note             text,
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  archived_by      uuid references auth.users(id),
  archive_reason   text,
  uploaded_by      uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_entity_documents_entity
  on entity_documents (organization_id, entity_type, entity_id, is_archived);

alter table entity_documents enable row level security;

-- ===========================================================================
-- 4) التواقيع — من وقّع، بأيّ صفة، بأيّ وسيلة، ومتى
--    السجل **غير قابل للتعديل ولا للحذف**: توقيعٌ يُعدَّل ليس توقيعًا.
-- ===========================================================================
create table if not exists document_signatures (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  document_kind     text not null
                      check (document_kind in ('patient_document','entity_document',
                                               'generated_document')),
  document_id       uuid not null,
  signer_role       text not null
                      check (signer_role in ('patient','guardian','doctor','nurse',
                                             'witness','employee','other')),
  signer_name       text not null,
  signer_id_number  text,
  relation_to_patient text,
  signer_user_id    uuid references auth.users(id),
  signature_method  text not null default 'on_screen'
                      check (signature_method in ('on_screen','paper_scan','digital_certificate')),
  signature_path    text,
  signed_at         timestamptz not null default now(),
  note              text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

-- الصفة الواحدة لا توقّع المستند مرّتين
create unique index if not exists uq_signature_role_once
  on document_signatures (document_kind, document_id, signer_role);
create index if not exists idx_signatures_document
  on document_signatures (organization_id, document_kind, document_id);

alter table document_signatures enable row level security;

-- ===========================================================================
-- 5) تجاوز الموافقة — يُسجَّل على الخدمة نفسها بمبرّر ومن قرّره
-- ===========================================================================
alter table patient_visit_services
  add column if not exists consent_override_reason text,
  add column if not exists consent_overridden_by uuid references auth.users(id),
  add column if not exists consent_overridden_at timestamptz;

-- ===========================================================================
-- 6) الدوال
-- ===========================================================================

-- الهجرة قابلة لإعادة التشغيل: تغيّر بصمة الدالّة يترك نسخةً قديمة تتعارض
-- مع الجديدة عند الاستدعاء، فتُسقط كل النسخ السابقة بالاسم أولًا.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_register_patient_document','app_register_entity_document',
                         'app_sign_document','app_archive_document',
                         'app_render_document_template','app_service_consent_status')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

-- 6.1 تسجيل مستند مريض (بعد رفع الملف إلى التخزين)
create or replace function app_register_patient_document(
  p_patient_id  uuid,
  p_storage_path text,
  p_file_name   text,
  -- `category` قائمة مغلقة قائمة من قبل: نوع الملف (صورة/مستند). تصنيف
  -- الغرض مكانه `doc_type_value_id` في البيانات المرجعية، ولا يُكرَّر هنا.
  p_category    text default 'document',
  p_visit_id    uuid default null,
  p_item_id     uuid default null,
  p_is_consent  boolean default false,
  p_expires_at  date default null,
  p_mime_type   text default null,
  p_size_bytes  bigint default null,
  p_template_id uuid default null,
  p_generated_document_id uuid default null,
  p_doc_type_value_id uuid default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_branch uuid;
  v_id     uuid;
  v_num    bigint;
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null then raise exception 'المريض غير موجود'; end if;
  if not app_has_permission(v_org, 'documents.upload') then
    raise exception 'صلاحيتك لا تسمح برفع المستندات (documents.upload)';
  end if;
  if coalesce(trim(p_storage_path), '') = '' then
    raise exception 'مسار الملف مطلوب — مستندٌ بلا ملف ليس مستندًا';
  end if;
  if coalesce(p_category, 'document') not in ('image','document') then
    raise exception 'نوع الملف غير معروف: % (المسموح: image أو document)', p_category;
  end if;
  if p_visit_id is not null then
    select branch_id into v_branch from patient_visits
     where id = p_visit_id and organization_id = v_org;
    if not found then raise exception 'الزيارة غير موجودة في هذه المنشأة'; end if;
  end if;
  if p_item_id is not null and not exists (
       select 1 from items where id = p_item_id and organization_id = v_org) then
    raise exception 'الخدمة غير موجودة في هذه المنشأة';
  end if;
  -- الموافقة المرتبطة بخدمة لا معنى لها إن لم تكن الخدمة تطلب موافقة
  if p_is_consent and p_item_id is not null and not exists (
       select 1 from items where id = p_item_id and requires_consent) then
    raise exception 'هذه الخدمة لا تتطلّب موافقة — لا تُربط بها موافقة';
  end if;

  v_num := app_next_document_number(v_org, 'patient_document', v_branch);

  insert into patient_documents (organization_id, branch_id, patient_id, visit_id, item_id,
                                 category, doc_type_value_id, storage_path, file_name,
                                 mime_type,
                                 file_size_bytes, note, expires_at, is_consent,
                                 template_id, generated_document_id, document_number,
                                 uploaded_by)
  values (v_org, v_branch, p_patient_id, p_visit_id, p_item_id,
          coalesce(p_category, 'document'), p_doc_type_value_id,
          trim(p_storage_path), p_file_name, p_mime_type,
          p_size_bytes, p_note, p_expires_at, coalesce(p_is_consent, false),
          p_template_id, p_generated_document_id, v_num, auth.uid())
  returning id into v_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, v_branch, auth.uid(), 'documents', 'add', v_id,
          case when p_is_consent then 'موافقة مريض' else 'مستند مريض' end,
          coalesce(p_file_name, p_storage_path));

  return v_id;
end $$;

-- 6.2 مستند كيان آخر
create or replace function app_register_entity_document(
  p_org         uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_title       text,
  p_storage_path text,
  p_file_name   text default null,
  p_category    text default null,
  p_branch_id   uuid default null,
  p_issue_date  date default null,
  p_expires_at  date default null,
  p_mime_type   text default null,
  p_size_bytes  bigint default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_ok boolean;
begin
  if not app_has_permission(p_org, 'documents.upload') then
    raise exception 'صلاحيتك لا تسمح برفع المستندات (documents.upload)';
  end if;
  if coalesce(trim(p_storage_path), '') = '' then
    raise exception 'مسار الملف مطلوب';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'عنوان المستند مطلوب';
  end if;

  -- **الكيان يجب أن يكون موجودًا في هذه المنشأة**: مستندٌ معلّق على معرّفٍ
  -- لا يقابله سجل هو مستندٌ لا يجده أحد.
  v_ok := case p_entity_type
    when 'asset' then exists (select 1 from assets
                               where id = p_entity_id and organization_id = p_org)
    when 'asset_calibration' then exists (select 1 from asset_calibrations
                               where id = p_entity_id and organization_id = p_org)
    when 'maintenance_order' then exists (select 1 from maintenance_orders
                               where id = p_entity_id and organization_id = p_org)
    when 'distributor' then exists (select 1 from distributors
                               where id = p_entity_id and organization_id = p_org)
    when 'purchase_invoice' then exists (select 1 from purchase_invoices
                               where id = p_entity_id and organization_id = p_org)
    when 'purchase_order' then exists (select 1 from purchase_orders
                               where id = p_entity_id and organization_id = p_org)
    when 'insurance_company' then exists (select 1 from insurance_companies
                               where id = p_entity_id and organization_id = p_org)
    when 'organization' then p_entity_id = p_org
    when 'branch' then exists (select 1 from branches
                               where id = p_entity_id and organization_id = p_org)
    else true
  end;
  if not v_ok then
    raise exception 'الكيان المرتبط بالمستند غير موجود في هذه المنشأة';
  end if;

  insert into entity_documents (organization_id, branch_id, entity_type, entity_id,
                                category, title, storage_path, file_name, mime_type,
                                file_size_bytes, issue_date, expires_at, note, uploaded_by)
  values (p_org, p_branch_id, p_entity_type, p_entity_id, p_category, trim(p_title),
          trim(p_storage_path), p_file_name, p_mime_type, p_size_bytes,
          p_issue_date, p_expires_at, p_note, auth.uid())
  returning id into v_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (p_org, p_branch_id, auth.uid(), 'documents', 'add', v_id, 'مستند كيان',
          format('%s — %s', p_entity_type, p_title));

  return v_id;
end $$;

-- 6.3 التوقيع
create or replace function app_sign_document(
  p_kind        text,
  p_document_id uuid,
  p_signer_role text,
  p_signer_name text,
  p_method      text default 'on_screen',
  p_signature_path text default null,
  p_signer_id_number text default null,
  p_relation    text default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_branch uuid;
  v_id     uuid;
  v_signed boolean;
begin
  if p_kind = 'patient_document' then
    select organization_id, branch_id, (signed_at is not null)
      into v_org, v_branch, v_signed
      from patient_documents where id = p_document_id for update;
  elsif p_kind = 'entity_document' then
    select organization_id, branch_id, false into v_org, v_branch, v_signed
      from entity_documents where id = p_document_id for update;
  elsif p_kind = 'generated_document' then
    select organization_id, null::uuid, false into v_org, v_branch, v_signed
      from generated_documents where id = p_document_id for update;
  else
    raise exception 'نوع مستند غير معروف: %', p_kind;
  end if;

  if v_org is null then raise exception 'المستند غير موجود'; end if;
  if not app_has_permission(v_org, 'consents.sign') then
    raise exception 'صلاحيتك لا تسمح بتسجيل التواقيع (consents.sign)';
  end if;
  if coalesce(trim(p_signer_name), '') = '' then
    raise exception 'اسم الموقِّع مطلوب — توقيعٌ بلا هوية موقِّع ليس توقيعًا';
  end if;
  -- التوقيع على الشاشة أو المسح الضوئي كلاهما يحتاج أثرًا محفوظًا
  if p_method in ('on_screen','paper_scan')
     and coalesce(trim(coalesce(p_signature_path, '')), '') = '' then
    raise exception 'صورة التوقيع مطلوبة لهذه الوسيلة';
  end if;
  if p_signer_role = 'guardian' and coalesce(trim(coalesce(p_relation, '')), '') = '' then
    raise exception 'صلة وليّ الأمر بالمريض مطلوبة';
  end if;

  insert into document_signatures (organization_id, branch_id, document_kind, document_id,
                                   signer_role, signer_name, signer_id_number,
                                   relation_to_patient, signer_user_id, signature_method,
                                   signature_path, note, created_by)
  values (v_org, v_branch, p_kind, p_document_id, p_signer_role, trim(p_signer_name),
          p_signer_id_number, p_relation,
          case when p_signer_role in ('doctor','nurse','employee') then auth.uid() end,
          p_method, p_signature_path, p_note, auth.uid())
  returning id into v_id;

  -- المستند يصير موقَّعًا عند أول توقيع، ويُسجَّل من ختمه
  if p_kind = 'patient_document' and not coalesce(v_signed, false) then
    update patient_documents
       set signed_at = now(), signed_by = auth.uid(), updated_at = now()
     where id = p_document_id;
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, v_branch, auth.uid(), 'documents', 'add', v_id, 'توقيع مستند',
          format('%s — %s', p_signer_role, p_signer_name));

  return v_id;
end $$;

-- 6.4 الأرشفة بدل الحذف
create or replace function app_archive_document(
  p_kind        text,
  p_document_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب الأرشفة مطلوب';
  end if;
  if p_kind = 'patient_document' then
    select organization_id into v_org from patient_documents where id = p_document_id;
  elsif p_kind = 'entity_document' then
    select organization_id into v_org from entity_documents where id = p_document_id;
  elsif p_kind = 'employee_document' then
    select organization_id into v_org from employee_documents where id = p_document_id;
  else
    raise exception 'نوع مستند غير معروف: %', p_kind;
  end if;
  if v_org is null then raise exception 'المستند غير موجود'; end if;
  if not app_has_permission(v_org, 'documents.archive') then
    raise exception 'صلاحيتك لا تسمح بأرشفة المستندات (documents.archive)';
  end if;

  if p_kind = 'patient_document' then
    update patient_documents
       set is_archived = true, archived_at = now(), archived_by = auth.uid(),
           archive_reason = p_reason, updated_at = now()
     where id = p_document_id;
  elsif p_kind = 'entity_document' then
    update entity_documents
       set is_archived = true, archived_at = now(), archived_by = auth.uid(),
           archive_reason = p_reason, updated_at = now()
     where id = p_document_id;
  else
    update employee_documents
       set is_archived = true, archived_at = now(), archived_by = auth.uid(),
           archive_reason = p_reason
     where id = p_document_id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_org, auth.uid(), 'documents', 'update', p_document_id, 'أرشفة مستند',
          p_kind, p_reason);
end $$;

-- 6.5 توليد مستند من قالب — بحقول حقيقية لا فراغات
create or replace function app_render_document_template(
  p_template_id uuid,
  p_patient_id  uuid default null,
  p_employee_id uuid default null,
  p_visit_id    uuid default null,
  p_extra       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t      document_templates%rowtype;
  v_body   text;
  v_vals   jsonb := coalesce(p_extra, '{}'::jsonb);
  v_id     uuid;
  v_key    text;
  v_left   text[];
  v_title  text;
begin
  select * into v_t from document_templates where id = p_template_id;
  if v_t.id is null then raise exception 'القالب غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'documents.upload') then
    raise exception 'صلاحيتك لا تسمح بتوليد المستندات (documents.upload)';
  end if;
  if v_t.is_disabled then
    raise exception 'القالب معطَّل — لا يُولَّد منه مستند';
  end if;

  -- الحقول المعروفة تُقرأ من السجلات الحقيقية
  v_vals := v_vals || jsonb_build_object(
    'organization_name', (select name from organizations where id = v_t.organization_id),
    'today', to_char(current_date, 'YYYY-MM-DD')
  );
  if p_patient_id is not null then
    v_vals := v_vals || (
      select jsonb_build_object(
        'patient_name', coalesce(p.name_ar, ''),
        'file_number',  coalesce(p.file_number::text, ''),
        'national_id',  coalesce(p.id_number, ''),
        'phone',        coalesce(p.phone_1, ''))
      from patients p where p.id = p_patient_id
        and p.organization_id = v_t.organization_id);
  end if;
  if p_visit_id is not null then
    v_vals := v_vals || (
      select jsonb_build_object(
        'visit_date',  to_char(v.visit_date, 'YYYY-MM-DD'),
        'doctor_name', coalesce(d.name_ar, ''),
        'branch_name', coalesce(b.name, ''))
      from patient_visits v
      left join doctors d on d.id = v.doctor_id
      left join branches b on b.id = v.branch_id
      where v.id = p_visit_id and v.organization_id = v_t.organization_id);
  end if;
  if p_employee_id is not null then
    v_vals := v_vals || (
      select jsonb_build_object(
        'employee_name', coalesce(e.name_ar, ''),
        'employee_number', coalesce(e.job_number::text, ''))
      from employees e where e.id = p_employee_id
        and e.organization_id = v_t.organization_id);
  end if;

  v_body := coalesce(v_t.body_html, '');
  for v_key in select jsonb_object_keys(v_vals) loop
    v_body := replace(v_body, '{{' || v_key || '}}', coalesce(v_vals ->> v_key, ''));
  end loop;

  -- **لا مستند بفراغات**: أيّ حقل لم يُعبَّأ يوقف التوليد بدل أن يُطبع فارغًا
  select array_agg(distinct m[1]) into v_left
    from regexp_matches(v_body, '\{\{([a-zA-Z0-9_]+)\}\}', 'g') as m;
  if v_left is not null and array_length(v_left, 1) > 0 then
    raise exception 'حقول القالب لم تُعبَّأ: %', array_to_string(v_left, '، ');
  end if;

  v_title := coalesce(v_t.name_ar, 'مستند');
  insert into generated_documents (organization_id, template_id, template_name_snapshot,
                                   patient_id, employee_id, title, body_html,
                                   extra_fields, created_by)
  values (v_t.organization_id, v_t.id, v_t.name_ar, p_patient_id, p_employee_id,
          v_title, v_body, v_vals, auth.uid())
  returning id into v_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_t.organization_id, auth.uid(), 'documents', 'add', v_id,
          'توليد مستند من قالب', v_title);

  return v_id;
end $$;

-- 6.6 حالة الموافقة لخدمة بعينها
create or replace function app_service_consent_status(
  p_visit_id uuid,
  p_item_id  uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_req     boolean;
  v_patient uuid;
  v_ok      int;
  v_expired int;
begin
  select requires_consent into v_req from items where id = p_item_id;
  if not coalesce(v_req, false) then return 'not_required'; end if;

  select patient_id into v_patient from patient_visits where id = p_visit_id;
  if v_patient is null then return 'missing'; end if;

  -- الموافقة المقبولة: موقَّعة، غير مؤرشفة، سارية، **وتخصّ هذا الإجراء**
  -- (مرتبطة بالخدمة نفسها، أو بهذه الزيارة تحديدًا)
  select count(*) into v_ok from patient_documents d
   where d.patient_id = v_patient and d.is_consent and not d.is_archived
     and d.signed_at is not null
     and (d.expires_at is null or d.expires_at >= current_date)
     and (d.item_id = p_item_id or (d.item_id is null and d.visit_id = p_visit_id));
  if v_ok > 0 then return 'signed'; end if;

  select count(*) into v_expired from patient_documents d
   where d.patient_id = v_patient and d.is_consent and not d.is_archived
     and d.signed_at is not null
     and d.expires_at is not null and d.expires_at < current_date
     and (d.item_id = p_item_id or (d.item_id is null and d.visit_id = p_visit_id));
  if v_expired > 0 then return 'expired'; end if;

  return 'missing';
end $$;

-- 6.7 الحارس: خدمة تحتاج موافقة لا تُنفَّذ بلا موافقة موقَّعة
create or replace function app_guard_service_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_name   text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('performed','invoiced','paid','claimed') then
    return new;
  end if;

  v_status := app_service_consent_status(new.visit_id, new.item_id);
  if v_status = 'not_required' or v_status = 'signed' then
    return new;
  end if;

  -- التجاوز ممكن، لكنه **قرارٌ موثَّق بمبرّر ومن صاحب صلاحية**، لا صمت
  if coalesce(trim(coalesce(new.consent_override_reason, '')), '') <> '' then
    if not app_has_permission(new.organization_id, 'consents.override') then
      raise exception 'صلاحيتك لا تسمح بتجاوز الموافقة (consents.override)';
    end if;
    new.consent_overridden_by := coalesce(new.consent_overridden_by, auth.uid());
    new.consent_overridden_at := coalesce(new.consent_overridden_at, now());
    return new;
  end if;

  select name_ar into v_name from items where id = new.item_id;
  raise exception 'لا يمكن تنفيذ «%» بلا موافقة موقَّعة (الحالة: %)',
    coalesce(v_name, 'الخدمة'),
    case when v_status = 'expired' then 'الموافقة منتهية' else 'لا توجد موافقة' end;
end $$;

drop trigger if exists trg_guard_service_consent on patient_visit_services;
create trigger trg_guard_service_consent
  before update on patient_visit_services
  for each row execute function app_guard_service_consent();

-- ===========================================================================
-- 7) المناظير
-- ===========================================================================

-- 7.1 كل المستندات في مكان واحد
drop view if exists v_document_expiry_alerts;
drop view if exists v_documents;
create view v_documents
with (security_invoker = on) as
select
  d.id,
  d.organization_id,
  d.branch_id,
  'patient_document'::text as document_kind,
  'patient'::text          as entity_type,
  d.patient_id             as entity_id,
  p.name_ar                as entity_name,
  coalesce(dt.name_ar, case when d.is_consent then 'موافقة' else d.category end) as category,
  coalesce(d.file_name, d.storage_path) as title,
  d.storage_path,
  d.mime_type,
  d.file_size_bytes,
  d.expires_at,
  d.is_consent,
  d.signed_at,
  d.is_archived,
  d.uploaded_by,
  d.created_at,
  d.created_at::date       as report_date
from patient_documents d
join patients p on p.id = d.patient_id
left join lookup_values dt on dt.id = d.doc_type_value_id
union all
select
  e.id, e.organization_id, e.branch_id, 'employee_document', 'employee',
  e.employee_id, emp.name_ar,
  coalesce(rv.name_ar, 'general'),
  coalesce(e.document_number, 'مستند موظف'),
  e.storage_path, e.mime_type, e.file_size_bytes, e.expiry_date,
  false, null::timestamptz, e.is_archived, e.uploaded_by, e.created_at,
  e.created_at::date
from employee_documents e
join employees emp on emp.id = e.employee_id
left join lookup_values rv on rv.id = e.document_type_value_id
union all
select
  x.id, x.organization_id, x.branch_id, 'entity_document', x.entity_type,
  x.entity_id, null::text,
  coalesce(x.category, 'general'), x.title, x.storage_path, x.mime_type,
  x.file_size_bytes, x.expires_at, false, null::timestamptz, x.is_archived,
  x.uploaded_by, x.created_at, x.created_at::date
from entity_documents x;

comment on view v_documents is
  'كل مستندات المنشأة في منظور واحد: مرضى وموظفون وكيانات أخرى، بمسارها وصلاحيتها وحالتها.';

-- 7.2 تنبيهات انتهاء المستندات
drop view if exists v_document_expiry_alerts;
create view v_document_expiry_alerts
with (security_invoker = on) as
select
  v.id, v.organization_id, v.branch_id, v.document_kind, v.entity_type,
  v.entity_id, v.entity_name, v.title, v.expires_at,
  (v.expires_at - current_date) as days_left,
  case when v.expires_at < current_date then 'منتهٍ' else 'يقارب الانتهاء' end as urgency,
  v.expires_at as report_date
from v_documents v
where not v.is_archived
  and v.expires_at is not null
  and v.expires_at <= current_date + 60;

comment on view v_document_expiry_alerts is
  'المستندات المنتهية أو التي تقارب الانتهاء خلال 60 يومًا — لكل الكيانات.';

-- 7.3 الموافقات المعلّقة — بدقّة الإجراء لا بوجود أيّ ورقة
drop view if exists v_pending_consents;
create view v_pending_consents
with (security_invoker = on) as
select
  s.id                as visit_service_id,
  s.organization_id,
  v.branch_id,
  v.id                as visit_id,
  v.patient_id,
  p.name_ar           as patient_name,
  p.file_number,
  s.item_id,
  i.name_ar           as item_name,
  i.consent_note_ar,
  v.visit_date,
  s.status,
  app_service_consent_status(v.id, s.item_id) as consent_status,
  (app_service_consent_status(v.id, s.item_id) = 'signed') as has_signed_consent,
  s.consent_override_reason,
  s.consent_overridden_by,
  v.visit_date        as report_date
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join patients p on p.id = v.patient_id
join items i on i.id = s.item_id
where i.requires_consent
  and s.status in ('draft','ordered','performed');

comment on view v_pending_consents is
  'الخدمات التي تحتاج موافقة وحالتها الحقيقية لكل إجراء على حدة — لا يكفي وجود أيّ موافقة سابقة للمريض.';

-- 7.4 تواقيع المستندات
drop view if exists v_document_signatures;
create view v_document_signatures
with (security_invoker = on) as
select
  g.id, g.organization_id, g.branch_id, g.document_kind, g.document_id,
  g.signer_role, g.signer_name, g.signer_id_number, g.relation_to_patient,
  g.signature_method, g.signature_path, g.signed_at,
  g.signed_at::date as report_date
from document_signatures g;

grant select on v_documents, v_document_expiry_alerts, v_pending_consents,
                v_document_signatures to authenticated;

-- ===========================================================================
-- 8) RLS ومنع الحذف
-- ===========================================================================
do $$
declare r record; pol record;
begin
  for r in select unnest(array['entity_documents','document_signatures']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;
    execute format($f$
      create policy %1$I_select on %1$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t);
    execute format($f$
      create policy %1$I_insert on %1$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t);
  end loop;
end $$;

-- التعديل على الجداول التي تُدار بالدوال فقط
do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'entity_documents' and policyname = 'entity_documents_update') then
    create policy entity_documents_update on entity_documents for update to authenticated
      using (app_is_member(organization_id)) with check (app_is_member(organization_id));
  end if;
end $$;

-- **التوقيع لا يُعدَّل ولا يُحذف، والمستند لا يُحذف**
create or replace function app_block_document_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'المستندات والتواقيع لا تُحذف — استخدم الأرشفة بسبب موثَّق';
end $$;

create or replace function app_block_signature_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'التوقيع لا يُعدَّل — توقيعٌ يُعدَّل ليس توقيعًا';
end $$;

do $$
declare r record;
begin
  for r in select unnest(array['patient_documents','employee_documents',
                               'entity_documents','document_signatures',
                               'generated_documents']) as t
  loop
    execute format('drop trigger if exists trg_block_delete_%1$s on %1$I', r.t);
    execute format($f$
      create trigger trg_block_delete_%1$s before delete on %1$I
        for each row execute function app_block_document_delete()
    $f$, r.t);
  end loop;
end $$;

drop trigger if exists trg_block_signature_update on document_signatures;
create trigger trg_block_signature_update
  before update on document_signatures
  for each row execute function app_block_signature_update();

-- ===========================================================================
-- 9) الميزة في كتالوج المزايا
-- ===========================================================================
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'documents', 'المستندات والموافقات', 'Documents & Consents', 'الإدارة', false, 276
where not exists (select 1 from feature_catalog where feature_key = 'documents');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'documents', true from organizations o
on conflict (organization_id, feature_key) do nothing;

do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_after_organization_created';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is not null and position('''documents''' in v_src) = 0 then
    v_new := replace(v_src, '''audit_log'',''settings''', '''audit_log'',''settings'',''documents''');
    if v_new = v_src then
      raise exception 'تعذّر إدراج ميزة المستندات في مزايا المنشأة الافتراضية';
    end if;
    execute v_new;
  end if;
end $$;

-- ===========================================================================
-- 10) حجب الدوال الجديدة عن الزوّار
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_register_patient_document','app_register_entity_document',
                         'app_sign_document','app_archive_document',
                         'app_render_document_template','app_service_consent_status',
                         'app_guard_service_consent')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_register_patient_document','app_register_entity_document',
                             'app_sign_document','app_archive_document',
                             'app_render_document_template','app_service_consent_status']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المستندات % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_service_consent') then
    raise exception 'حارس الموافقة غير مركَّب — الخدمة تُنفَّذ بلا موافقة';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_signature_role_once') then
    raise exception 'الصفة الواحدة تستطيع التوقيع مرّتين';
  end if;

  foreach v_v in array array['v_documents','v_document_expiry_alerts',
                             'v_pending_consents','v_document_signatures']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v
         and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%')
    then
      raise exception 'المنظور % بلا security_invoker — يتجاوز عزل المنشآت', v_v;
    end if;
  end loop;
end $$;
