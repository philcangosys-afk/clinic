-- ============================================================================
-- 0180 — ZATCA: الأسرار في Supabase Vault، ودالّة تثبيت الإرسال المقبول
-- ============================================================================
--
-- المفتاح الخاص وCSID والسرّ (للتوافق وللإنتاج) لا تُحفظ نصًّا في أيّ جدول:
-- تُشفَّر في `vault.secrets`، والجدول يحمل معرّفها وحده. وكل دوال هذا الملف
-- لـ`service_role` وحده — أي للدوالّ الطرفية — ومرفوضة لـ`anon` و`authenticated`.
--
--   store_zatca_secret / delete_zatca_secret / get_zatca_credentials
--   store_zatca_compliance_credentials / store_zatca_production_credentials
--   finalize_zatca_accepted_submission — تحديث ذرّي بعد قبول ZATCA: يتقدّم
--   التسلسل، ويُكتب السجلّ، وتُختم الفاتورة برمز QR — كلّها أو لا شيء.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

create extension if not exists supabase_vault with schema vault;

alter table zatca_onboarding_settings
  add column if not exists private_key_secret_id       uuid,
  add column if not exists compliance_csid_secret_id   uuid,
  add column if not exists compliance_secret_secret_id uuid,
  add column if not exists production_csid_secret_id   uuid,
  add column if not exists production_secret_secret_id uuid;

-- ── تخزين سرّ واحد ──────────────────────────────────────────────────────────
create or replace function store_zatca_secret(
  p_onboarding_id uuid, p_kind text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_secret_id uuid;
  v_name      text;
begin
  if p_secret is null or p_secret = '' then
    raise exception 'ZATCA_SECRET_MUST_NOT_BE_EMPTY';
  end if;
  if p_kind not in ('private_key', 'compliance_csid', 'compliance_secret',
                    'production_csid', 'production_secret') then
    raise exception 'INVALID_ZATCA_SECRET_KIND';
  end if;

  select case p_kind
           when 'private_key'       then private_key_secret_id
           when 'compliance_csid'   then compliance_csid_secret_id
           when 'compliance_secret' then compliance_secret_secret_id
           when 'production_csid'   then production_csid_secret_id
           when 'production_secret' then production_secret_secret_id
         end
    into v_secret_id
    from zatca_onboarding_settings
   where id = p_onboarding_id
   for update;
  if not found then raise exception 'ZATCA_ONBOARDING_NOT_FOUND'; end if;

  v_name := 'zatca:' || p_onboarding_id::text || ':' || p_kind;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_secret, v_name, 'ZATCA credential — server-only');
  else
    perform vault.update_secret(v_secret_id, p_secret, v_name, 'ZATCA credential — server-only');
  end if;

  update zatca_onboarding_settings
     set private_key_secret_id       = case when p_kind = 'private_key'       then v_secret_id else private_key_secret_id end,
         compliance_csid_secret_id   = case when p_kind = 'compliance_csid'   then v_secret_id else compliance_csid_secret_id end,
         compliance_secret_secret_id = case when p_kind = 'compliance_secret' then v_secret_id else compliance_secret_secret_id end,
         production_csid_secret_id   = case when p_kind = 'production_csid'   then v_secret_id else production_csid_secret_id end,
         production_secret_secret_id = case when p_kind = 'production_secret' then v_secret_id else production_secret_secret_id end,
         updated_at = now()
   where id = p_onboarding_id;

  return v_secret_id;
end;
$$;

-- ── محو سرّ واحد (عند أرشفة جهاز) ──────────────────────────────────────────
create or replace function delete_zatca_secret(p_onboarding_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_secret_id uuid;
begin
  if p_kind not in ('private_key', 'compliance_csid', 'compliance_secret',
                    'production_csid', 'production_secret') then
    raise exception 'INVALID_ZATCA_SECRET_KIND';
  end if;

  select case p_kind
           when 'private_key'       then private_key_secret_id
           when 'compliance_csid'   then compliance_csid_secret_id
           when 'compliance_secret' then compliance_secret_secret_id
           when 'production_csid'   then production_csid_secret_id
           when 'production_secret' then production_secret_secret_id
         end
    into v_secret_id
    from zatca_onboarding_settings
   where id = p_onboarding_id
   for update;
  if not found then raise exception 'ZATCA_ONBOARDING_NOT_FOUND'; end if;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  update zatca_onboarding_settings
     set private_key_secret_id       = case when p_kind = 'private_key'       then null else private_key_secret_id end,
         compliance_csid_secret_id   = case when p_kind = 'compliance_csid'   then null else compliance_csid_secret_id end,
         compliance_secret_secret_id = case when p_kind = 'compliance_secret' then null else compliance_secret_secret_id end,
         production_csid_secret_id   = case when p_kind = 'production_csid'   then null else production_csid_secret_id end,
         production_secret_secret_id = case when p_kind = 'production_secret' then null else production_secret_secret_id end,
         updated_at = now()
   where id = p_onboarding_id;
end;
$$;

-- ── قراءة الأسرار دفعةً واحدة — للدالّة الطرفية وحدها ───────────────────────
create or replace function get_zatca_credentials(p_onboarding_id uuid)
returns table (
  private_key_pem   text,
  compliance_csid   text,
  compliance_secret text,
  production_csid   text,
  production_secret text
)
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $$
  select pk.decrypted_secret, cc.decrypted_secret, cs.decrypted_secret,
         pc.decrypted_secret, ps.decrypted_secret
    from zatca_onboarding_settings s
    left join vault.decrypted_secrets pk on pk.id = s.private_key_secret_id
    left join vault.decrypted_secrets cc on cc.id = s.compliance_csid_secret_id
    left join vault.decrypted_secrets cs on cs.id = s.compliance_secret_secret_id
    left join vault.decrypted_secrets pc on pc.id = s.production_csid_secret_id
    left join vault.decrypted_secrets ps on ps.id = s.production_secret_secret_id
   where s.id = p_onboarding_id;
$$;

-- ── شهادة التوافق: السرّان في Vault والمقنّع في الجدول، معًا ────────────────
create or replace function store_zatca_compliance_credentials(
  p_onboarding_id uuid,
  p_request_id    text,
  p_csid          text,
  p_secret        text,
  p_csid_masked   text,
  p_issued_at     timestamptz)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  perform store_zatca_secret(p_onboarding_id, 'compliance_csid', p_csid);
  perform store_zatca_secret(p_onboarding_id, 'compliance_secret', p_secret);

  update zatca_onboarding_settings
     set status = 'compliance_ready',
         compliance_request_id = p_request_id,
         compliance_csid_masked = p_csid_masked,
         compliance_issued_at = p_issued_at,
         last_error = null,
         updated_at = p_issued_at
   where id = p_onboarding_id;
  if not found then raise exception 'ZATCA_ONBOARDING_NOT_FOUND'; end if;
end;
$$;

-- ── شهادة الإنتاج: تُحفظ والإرسال الحقيقي يبقى معطّلًا ─────────────────────
create or replace function store_zatca_production_credentials(
  p_onboarding_id          uuid,
  p_request_id             text,
  p_csid                   text,
  p_secret                 text,
  p_csid_masked            text,
  p_issued_at              timestamptz,
  p_certificate_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  perform store_zatca_secret(p_onboarding_id, 'production_csid', p_csid);
  perform store_zatca_secret(p_onboarding_id, 'production_secret', p_secret);

  update zatca_onboarding_settings
     set production_request_id = p_request_id,
         production_csid_masked = p_csid_masked,
         production_issued_at = p_issued_at,
         production_status = 'issued',
         production_enabled = false,
         production_confirmed_by = null,
         production_confirmed_at = null,
         certificate_expires_at = p_certificate_expires_at,
         certificate_revoked_at = null,
         last_error = null,
         updated_at = p_issued_at
   where id = p_onboarding_id;
  if not found then raise exception 'ZATCA_ONBOARDING_NOT_FOUND'; end if;
end;
$$;

-- ── تثبيت الإرسال المقبول ذرّيًا ────────────────────────────────────────────
create or replace function finalize_zatca_accepted_submission(
  p_onboarding_id       uuid,
  p_reservation_token   uuid,
  p_invoice_hash        text,
  p_log_id              uuid,
  p_status              text,
  p_http_status         integer,
  p_request_uuid        text,
  p_icv                 bigint,
  p_previous_pih        text,
  p_request_payload     jsonb,
  p_response            jsonb,
  p_response_text       text,
  p_invoice_id          uuid,
  p_mode                text,
  p_qr_code_data        text,
  p_cryptographic_stamp text,
  p_invoice_xml         text,
  p_submitted_at        timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('cleared', 'reported') then
    raise exception 'INVALID_ZATCA_ACCEPTED_STATUS';
  end if;

  update zatca_device_sequences
     set next_icv = next_icv + 1,
         last_pih = p_invoice_hash,
         reservation_token = null,
         reservation_expires_at = null,
         blocked_at = null,
         blocked_reason = null,
         updated_at = now()
   where onboarding_id = p_onboarding_id
     and reservation_token = p_reservation_token;
  if not found then raise exception 'INVALID_ZATCA_SEQUENCE_RESERVATION'; end if;

  update zatca_invoice_submission_logs
     set status = p_status,
         http_status = p_http_status,
         request_uuid = p_request_uuid,
         invoice_hash = p_invoice_hash,
         icv = p_icv,
         previous_pih = p_previous_pih,
         request_payload = p_request_payload,
         response = p_response,
         response_text = p_response_text,
         signed_invoice_xml = coalesce(p_invoice_xml, signed_invoice_xml),
         qr_code_data = p_qr_code_data,
         cryptographic_stamp = p_cryptographic_stamp,
         retry_after = null,
         last_error = null,
         updated_at = now()
   where id = p_log_id;
  if not found then raise exception 'ZATCA_SUBMISSION_LOG_NOT_FOUND'; end if;

  update sales_invoices
     set zatca_uuid = p_request_uuid,
         zatca_icv = p_icv,
         zatca_pih = p_previous_pih,
         zatca_invoice_hash = p_invoice_hash,
         zatca_qr_data = p_qr_code_data,
         zatca_stamp = p_cryptographic_stamp,
         zatca_status = p_status,
         zatca_mode = p_mode,
         zatca_response = p_response,
         zatca_submitted_at = p_submitted_at,
         zatca_cleared_at = case when p_status = 'cleared' then p_submitted_at end,
         zatca_reported_at = case when p_status = 'reported' then p_submitted_at end
   where id = p_invoice_id;
  if not found then raise exception 'ZATCA_INVOICE_RECORD_NOT_FOUND'; end if;
end;
$$;

-- ── الصلاحيات: service_role وحده ────────────────────────────────────────────
revoke all on function store_zatca_secret(uuid, text, text) from public, anon, authenticated;
revoke all on function delete_zatca_secret(uuid, text) from public, anon, authenticated;
revoke all on function get_zatca_credentials(uuid) from public, anon, authenticated;
revoke all on function store_zatca_compliance_credentials(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function store_zatca_production_credentials(uuid, text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function finalize_zatca_accepted_submission(uuid, uuid, text, uuid, text, integer, text, bigint, text, jsonb, jsonb, text, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;

grant execute on function store_zatca_secret(uuid, text, text) to service_role;
grant execute on function delete_zatca_secret(uuid, text) to service_role;
grant execute on function get_zatca_credentials(uuid) to service_role;
grant execute on function store_zatca_compliance_credentials(uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function store_zatca_production_credentials(uuid, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function finalize_zatca_accepted_submission(uuid, uuid, text, uuid, text, integer, text, bigint, text, jsonb, jsonb, text, uuid, text, text, text, text, timestamptz) to service_role;

revoke all on vault.secrets from public, anon, authenticated;
revoke all on vault.decrypted_secrets from public, anon, authenticated;

comment on function get_zatca_credentials(uuid) is
  'تعيد أسرار ZATCA مفكوكة لـservice_role وحده (0180). لا تُعرض نتيجتها في واجهة ولا سجلّ.';

-- ── تحقّق: لا دالّة سرٍّ قابلة للاستدعاء من المتصفّح ─────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array['store_zatca_secret', 'delete_zatca_secret', 'get_zatca_credentials',
                           'store_zatca_compliance_credentials', 'store_zatca_production_credentials',
                           'finalize_zatca_accepted_submission', 'reserve_zatca_sequence',
                           'finalize_zatca_sequence', 'block_zatca_sequence', 'release_zatca_sequence']
  loop
    if exists (
      select 1 from pg_proc p
       where p.proname = f
         and (has_function_privilege('anon', p.oid, 'execute')
              or has_function_privilege('authenticated', p.oid, 'execute'))
    ) then
      raise exception '0180: الدالّة % قابلة للاستدعاء من المتصفّح', f;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
