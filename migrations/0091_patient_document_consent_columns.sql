begin;

alter table patient_documents
  add column if not exists expires_at date,
  add column if not exists is_consent boolean not null default false,
  add column if not exists signed_at timestamptz;

create index if not exists idx_patient_documents_expiry
  on patient_documents (organization_id, expires_at)
  where expires_at is not null;

commit;
