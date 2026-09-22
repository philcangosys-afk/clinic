-- ============================================================================
-- 0178 — الربط مع ZATCA (المرحلة الثانية): جدول التهيئة وسجلّ تدقيقها
-- ============================================================================
--
-- منقولٌ من التنفيذ المُجرَّب في نظام زين ERP، مع ثلاثة فروق تفرضها ZainCare:
--
--   * **المنشأة لا المفتاح النصّي:** كل تهيئة مربوطة بـ`organization_id`
--     (وفرعٍ اختياري)، فلا تختلط أجهزة منشأتين على قاعدةٍ واحدة.
--   * **لا عمود سرٍّ واحدٌ في الجدول:** المفتاح الخاص وCSID والسرّ في Vault
--     وحده (0180). الجدول يحمل النسخة المقنّعة ومعرّفات Vault فقط.
--   * **الأرشفة لا الحذف:** «بدء تهيئة جديدة» يؤرشف السجلّ القديم ويمحو
--     أسراره من Vault، ويبقى سجلّ ما جرى عليه.
--
-- الجدولان للخادم وحده: لا `anon` ولا `authenticated` يقرأ منهما شيئًا. الواجهة
-- تقرأ الحالة عبر الدالّة الطرفية `zatca-onboarding` بعد التحقّق من الصلاحية.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

create table if not exists zatca_onboarding_settings (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references organizations(id),
  branch_id                 uuid references branches(id),
  created_by                uuid references auth.users(id),
  mode                      text not null default 'simulation'
                              check (mode in ('simulation', 'production')),

  -- بيانات المنشأة القانونية
  company_name_ar           text not null,
  company_name_en           text,
  vat_number                text not null check (vat_number ~ '^[0-9]{15}$'),
  vat_effective_date        date,
  commercial_registration   text not null check (commercial_registration ~ '^[0-9]{10,15}$'),
  branch_name               text not null,
  industry                  text not null,

  -- العنوان الوطني المنظَّم، ونصّه المجمَّع للعرض وللشهادة
  branch_location           text not null,
  building_number           text check (building_number is null or building_number ~ '^[0-9]{4}$'),
  street_name               text,
  district                  text,
  city                      text,
  postal_code               text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  additional_number         text check (additional_number is null or additional_number ~ '^[0-9]{4}$'),
  short_address             text check (short_address is null or short_address ~ '^[A-Z0-9]{1,8}$'),

  -- وحدة إصدار الفواتير (EGS)
  device_manufacturer       text not null,
  device_model              text not null,
  device_serial             text not null check (device_serial ~ '^[A-Za-z0-9._/-]+$'),
  common_name               text not null,
  invoice_type              text not null default '1100' check (invoice_type in ('1000', '0100', '1100')),

  -- دورة الحياة
  status                    text not null default 'identity_saved' check (status in (
                              'identity_saved', 'csr_generated', 'compliance_ready',
                              'compliance_testing', 'compliance_passed', 'failed')),
  csr_pem                   text,
  public_key_pem            text,

  -- شهادة التوافق — المقنّع وحده هنا، والحقيقيّ في Vault
  compliance_request_id     text,
  compliance_csid_masked    text,
  compliance_issued_at      timestamptz,
  compliance_results        jsonb not null default '[]'::jsonb,

  -- شهادة الإنتاج
  production_request_id     text,
  production_csid_masked    text,
  production_issued_at      timestamptz,
  production_status         text not null default 'not_requested'
                              check (production_status in ('not_requested', 'issued', 'failed')),
  certificate_expires_at    timestamptz,
  certificate_revoked_at    timestamptz,

  -- بوّابة الإرسال الحقيقي: لا تُفتح إلّا بعبارة التأكيد
  production_enabled        boolean not null default false,
  production_confirmed_by   uuid references auth.users(id),
  production_confirmed_at   timestamptz,

  last_error                text,

  -- الأرشفة (بدء تهيئة جديدة) — لا حذف
  is_archived               boolean not null default false,
  archived_at               timestamptz,
  archived_by               uuid references auth.users(id),

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- جهازٌ واحد حيّ لكل (منشأة، بيئة، رقم تسلسلي)
create unique index if not exists uq_zatca_onboarding_device
  on zatca_onboarding_settings (organization_id, mode, device_serial)
  where not is_archived;
create index if not exists idx_zatca_onboarding_org
  on zatca_onboarding_settings (organization_id, mode, updated_at desc);

create table if not exists zatca_onboarding_audit (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  onboarding_id   uuid references zatca_onboarding_settings(id),
  actor_id        uuid references auth.users(id),
  action          text not null,
  result          text not null check (result in ('success', 'failed')),
  http_status     integer,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_zatca_onboarding_audit
  on zatca_onboarding_audit (onboarding_id, created_at desc);

-- للخادم وحده
alter table zatca_onboarding_settings enable row level security;
alter table zatca_onboarding_audit enable row level security;
revoke all on zatca_onboarding_settings from public, anon, authenticated;
revoke all on zatca_onboarding_audit from public, anon, authenticated;
grant all on zatca_onboarding_settings to service_role;
grant all on zatca_onboarding_audit to service_role;

comment on table zatca_onboarding_settings is
  'تهيئة ZATCA لكل جهاز (0178). للخادم وحده: الأسرار في Vault، والواجهة تقرأ عبر الدالّة الطرفية zatca-onboarding.';
comment on table zatca_onboarding_audit is
  'سجلّ عمليات تهيئة ZATCA، منظَّفٌ من الأسرار قبل الحفظ (0178).';

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
     where table_name in ('zatca_onboarding_settings', 'zatca_onboarding_audit')
       and grantee in ('anon', 'authenticated')
  ) then
    raise exception '0178: جدول ZATCA مكشوف لغير الخادم';
  end if;
end $$;

commit;
