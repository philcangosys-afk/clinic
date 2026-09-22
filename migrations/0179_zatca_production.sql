-- ============================================================================
-- 0179 — ZATCA: سلسلة الفواتير (ICV/PIH)، سجلّ الإرسال، وأعمدة الفاتورة
-- ============================================================================
--
-- * `zatca_device_sequences` — عدّاد ICV وبصمة الفاتورة السابقة PIH لكل جهاز،
--   تُحجز ذرّيًا (`reserve_zatca_sequence`) فلا يأخذ طلبان متزامنان الرقم نفسه،
--   ولا يتقدّم العدّاد إلّا بعد قبول ZATCA (`finalize_…` في 0180).
-- * `zatca_invoice_submission_logs` — كل محاولة إرسال بمفتاح منع التكرار
--   (idempotency_key): الفاتورة التي قُبلت لا تُرسل ثانية، والتي نتيجتها غير
--   محسومة (ambiguous) توقف الجهاز حتى المراجعة اليدوية.
-- * أعمدة ZATCA على `sales_invoices` (الفاتورة والإشعار الدائن والمدين كلّها
--   في هذا الجدول). بأسماء تبدأ بـ`zatca_` لأنّ `zatca_qr` قائمٌ منذ 0058
--   لرمز المرحلة الأولى. والـXML الموقّع يبقى في سجلّ الإرسال لا هنا: مُحفِّز
--   التدقيق يحفظ الصفّ كاملًا مع كل تحديث، فكان سيتكرّر مع كل دفعة.
--
-- الجداول الثلاثة الجديدة للخادم وحده. آمنة للتكرار.
-- ============================================================================

begin;

-- ── 1) أعمدة الفاتورة ────────────────────────────────────────────────────────
alter table sales_invoices
  add column if not exists zatca_uuid          text,
  add column if not exists zatca_icv           bigint,
  add column if not exists zatca_pih           text,
  add column if not exists zatca_invoice_hash  text,
  add column if not exists zatca_qr_data       text,
  add column if not exists zatca_stamp         text,
  add column if not exists zatca_status        text not null default 'pending',
  add column if not exists zatca_mode          text,
  add column if not exists zatca_response      jsonb,
  add column if not exists zatca_submitted_at  timestamptz,
  add column if not exists zatca_cleared_at    timestamptz,
  add column if not exists zatca_reported_at   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_invoices_zatca_status_check') then
    alter table sales_invoices add constraint sales_invoices_zatca_status_check
      check (zatca_status in ('pending', 'submitted', 'cleared', 'reported', 'rejected', 'failed', 'ambiguous'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_invoices_zatca_mode_check') then
    alter table sales_invoices add constraint sales_invoices_zatca_mode_check
      check (zatca_mode is null or zatca_mode in ('simulation', 'production'));
  end if;
end $$;

create unique index if not exists uq_sales_invoices_zatca_uuid
  on sales_invoices (zatca_uuid) where zatca_uuid is not null;

comment on column sales_invoices.zatca_status is
  'حالة الفاتورة لدى ZATCA المرحلة الثانية (0179): pending لم تُرسل، cleared مصادَق عليها (معيارية)، reported مُبلَّغ عنها (مبسّطة)، rejected مرفوضة، ambiguous غير محسومة — لا يُعاد إرسالها قبل المراجعة.';
comment on column sales_invoices.zatca_qr_data is
  'نصّ رمز QR كما في الـXML الموقّع (المرحلة الثانية). يختلف عن zatca_qr (المرحلة الأولى، 0058).';

-- ── 2) تسلسل الجهاز ─────────────────────────────────────────────────────────
create table if not exists zatca_device_sequences (
  id                      uuid primary key default gen_random_uuid(),
  onboarding_id           uuid not null unique references zatca_onboarding_settings(id),
  next_icv                bigint not null default 1 check (next_icv > 0),
  last_pih                text not null default 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  reservation_token       uuid,
  reservation_expires_at  timestamptz,
  blocked_at              timestamptz,
  blocked_reason          text,
  updated_at              timestamptz not null default now()
);

-- ── 3) سجلّ الإرسال ─────────────────────────────────────────────────────────
create table if not exists zatca_invoice_submission_logs (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id),
  invoice_id           uuid not null references sales_invoices(id),
  onboarding_id        uuid references zatca_onboarding_settings(id),
  document_type        text not null check (document_type in ('invoice', 'creditNote', 'debitNote')),
  invoice_type         text not null check (invoice_type in ('standard', 'simplified')),
  mode                 text not null check (mode in ('simulation', 'production')),
  endpoint             text not null,
  http_status          integer,
  request_uuid         text,
  invoice_hash         text,
  icv                  bigint,
  previous_pih         text,
  idempotency_key      text,
  request_payload      jsonb not null default '{}'::jsonb,
  response             jsonb not null default '{}'::jsonb,
  response_text        text,
  signed_invoice_xml   text,
  qr_code_data         text,
  cryptographic_stamp  text,
  status               text not null check (status in (
                         'submitted', 'cleared', 'reported', 'rejected', 'failed', 'ambiguous')),
  attempt_count        integer not null default 1,
  retry_after          timestamptz,
  last_error           text,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists uq_zatca_submission_idempotency
  on zatca_invoice_submission_logs (idempotency_key) where idempotency_key is not null;
create index if not exists idx_zatca_submission_invoice
  on zatca_invoice_submission_logs (invoice_id, created_at desc);
create index if not exists idx_zatca_submission_ambiguous
  on zatca_invoice_submission_logs (onboarding_id) where status = 'ambiguous';

alter table zatca_device_sequences enable row level security;
alter table zatca_invoice_submission_logs enable row level security;
revoke all on zatca_device_sequences from public, anon, authenticated;
revoke all on zatca_invoice_submission_logs from public, anon, authenticated;
grant all on zatca_device_sequences to service_role;
grant all on zatca_invoice_submission_logs to service_role;

-- ── 4) حجز التسلسل ذرّيًا ───────────────────────────────────────────────────
create or replace function reserve_zatca_sequence(p_onboarding_id uuid)
returns table (reservation_token uuid, icv bigint, previous_pih text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid := gen_random_uuid();
  v_row   zatca_device_sequences%rowtype;
begin
  insert into zatca_device_sequences (onboarding_id)
  values (p_onboarding_id)
  on conflict (onboarding_id) do nothing;

  select * into v_row
    from zatca_device_sequences
   where onboarding_id = p_onboarding_id
   for update;

  if v_row.blocked_at is not null then
    raise exception 'ZATCA_SEQUENCE_BLOCKED: %', coalesce(v_row.blocked_reason, 'يلزم تطابق يدوي');
  end if;
  if v_row.reservation_token is not null and v_row.reservation_expires_at > now() then
    raise exception 'ZATCA_SEQUENCE_BUSY';
  end if;

  update zatca_device_sequences
     set reservation_token = v_token,
         reservation_expires_at = now() + interval '2 minutes',
         updated_at = now()
   where onboarding_id = p_onboarding_id;

  return query select v_token, v_row.next_icv, v_row.last_pih;
end;
$$;

create or replace function finalize_zatca_sequence(
  p_onboarding_id uuid, p_reservation_token uuid, p_invoice_hash text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update zatca_device_sequences
     set next_icv = next_icv + 1,
         last_pih = p_invoice_hash,
         reservation_token = null,
         reservation_expires_at = null,
         updated_at = now()
   where onboarding_id = p_onboarding_id
     and reservation_token = p_reservation_token;
  if not found then raise exception 'INVALID_ZATCA_SEQUENCE_RESERVATION'; end if;
end;
$$;

create or replace function block_zatca_sequence(
  p_onboarding_id uuid, p_reservation_token uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update zatca_device_sequences
     set blocked_at = now(),
         blocked_reason = p_reason,
         reservation_expires_at = null,
         updated_at = now()
   where onboarding_id = p_onboarding_id
     and reservation_token = p_reservation_token;
  if not found then raise exception 'INVALID_ZATCA_SEQUENCE_RESERVATION'; end if;
end;
$$;

create or replace function release_zatca_sequence(
  p_onboarding_id uuid, p_reservation_token uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update zatca_device_sequences
     set reservation_token = null,
         reservation_expires_at = null,
         updated_at = now()
   where onboarding_id = p_onboarding_id
     and reservation_token = p_reservation_token;
$$;

revoke all on function reserve_zatca_sequence(uuid) from public, anon, authenticated;
revoke all on function finalize_zatca_sequence(uuid, uuid, text) from public, anon, authenticated;
revoke all on function block_zatca_sequence(uuid, uuid, text) from public, anon, authenticated;
revoke all on function release_zatca_sequence(uuid, uuid) from public, anon, authenticated;
grant execute on function reserve_zatca_sequence(uuid) to service_role;
grant execute on function finalize_zatca_sequence(uuid, uuid, text) to service_role;
grant execute on function block_zatca_sequence(uuid, uuid, text) to service_role;
grant execute on function release_zatca_sequence(uuid, uuid) to service_role;

comment on table zatca_device_sequences is
  'سلسلة ICV/PIH لكل جهاز ZATCA، تُحجز ذرّيًا (0179). للخادم وحده.';
comment on table zatca_invoice_submission_logs is
  'كل محاولة إرسال فاتورة إلى ZATCA بمفتاح منع التكرار والـXML الموقّع (0179). للخادم وحده.';

commit;
