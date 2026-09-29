-- ============================================================================
-- 0194 — أرشيف النظام السابق (Kizen Clinic) في ملف المريض
-- ============================================================================
--
-- العيادة عملت على Kizen من 21/10/2023. فواتيرها وسنداتها ومواعيدها
-- واتفاقياتها وزياراتها تُنقل إلى هنا **مرجعًا للاطلاع**، لا مستنداتٍ حيّة:
--
--   * لا تدخل في `sales_invoices`: لها ترقيمها وسلسلة ZATCA الخاصّة بها
--     في Kizen، وقد أُبلغت الهيئة بها من هناك. إدخالها فواتيرَ هنا يخلط
--     ترقيمين ويُعيد إرسال ما أُرسل.
--   * لا تدخل في الحسابات ولا اليومية ولا التقارير المالية.
--   * تُقرأ فقط: لا صلاحية إدراج ولا تعديل ولا حذف لأيّ مستخدم. يملؤها
--     سكربت الاستيراد وحده (دور postgres).
--
-- الاستثناء الوحيد للكتابة: **تسوية متبقٍّ قديم** — فاتورة Kizen بقي عليها
-- مبلغ، حصّله الصندوق بسند قبضٍ عاديّ، فتُعلَّم هنا «سُوّيت» بمن وأين ومتى
-- (`app_settle_legacy_invoice`). المال نفسه يدخل بالسند، لا بهذه العلامة.
--
-- الاتفاقيات التي عليها متبقٍّ تُنقل **حيّةً** إلى `treatment_agreements`
-- (سكربت الاستيراد)، ويُحفظ هنا ربطها بأصلها (`migrated_agreement_id`).
--
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ── 1) الفواتير ─────────────────────────────────────────────────────────────
create table if not exists legacy_invoices (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  patient_id          uuid references patients(id) on delete cascade,
  file_number         bigint,
  legacy_number       bigint not null,
  zatca_number        text,
  kind                text not null default 'sale' check (kind in ('sale', 'return')),
  issued_at           timestamptz,
  doctor_name         text,
  employee_name       text,
  clinic_name         text,
  works               text,
  gross_amount        numeric(14,2) not null default 0,
  discount_amount     numeric(14,2) not null default 0,
  taxable_amount      numeric(14,2) not null default 0,
  vat_amount          numeric(14,2) not null default 0,
  exemption_amount    numeric(14,2) not null default 0,
  net_amount          numeric(14,2) not null default 0,
  paid_amount         numeric(14,2) not null default 0,
  remaining_amount    numeric(14,2) generated always as (net_amount - paid_amount) stored,
  note                text,
  agreement_number    bigint,
  settled_at          timestamptz,
  settled_by          uuid references auth.users(id),
  settle_note         text,
  unique (organization_id, legacy_number)
);
create index if not exists idx_legacy_invoices_patient on legacy_invoices (patient_id, issued_at desc);

-- ── 2) بنود الفواتير ────────────────────────────────────────────────────────
create table if not exists legacy_invoice_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  legacy_invoice_id   uuid not null references legacy_invoices(id) on delete cascade,
  patient_id          uuid references patients(id) on delete cascade,
  line_no             int not null default 0,
  line_date           date,
  code                text,
  source_code         text,
  service             text,
  category            text,
  doctor_name         text,
  unit_price          numeric(14,2) not null default 0,
  qty                 numeric(12,2) not null default 0,
  gross_amount        numeric(14,2) not null default 0,
  discount_amount     numeric(14,2) not null default 0,
  discount_percent    numeric(7,2)  not null default 0,
  general_discount    numeric(14,4) not null default 0,
  taxable_amount      numeric(14,2) not null default 0,
  vat_rate            numeric(5,2)  not null default 0,
  vat_amount          numeric(14,2) not null default 0,
  exemption_amount    numeric(14,2) not null default 0,
  net_amount          numeric(14,2) not null default 0,
  offer_name          text,
  coupon              text,
  note                text
);
create index if not exists idx_legacy_items_invoice on legacy_invoice_items (legacy_invoice_id, line_no);

-- ── 3) سندات القبض ──────────────────────────────────────────────────────────
create table if not exists legacy_receipts (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  patient_id          uuid references patients(id) on delete cascade,
  legacy_invoice_id   uuid references legacy_invoices(id) on delete cascade,
  file_number         bigint,
  legacy_number       bigint not null,
  legacy_invoice_number bigint,
  zatca_number        text,
  received_at         timestamptz,
  method              text,
  amount              numeric(14,2) not null default 0,
  bank_reference      text,
  statement           text,
  user_name           text,
  note                text,
  unique (organization_id, legacy_number)
);
create index if not exists idx_legacy_receipts_patient on legacy_receipts (patient_id, received_at desc);
create index if not exists idx_legacy_receipts_invoice on legacy_receipts (legacy_invoice_id);

-- ── 4) الاتفاقيات ───────────────────────────────────────────────────────────
create table if not exists legacy_agreements (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  patient_id            uuid references patients(id) on delete cascade,
  file_number           bigint,
  legacy_number         bigint not null,
  agreement_date        timestamptz,
  legacy_created_at     timestamptz,
  services              text,
  codes                 text,
  teeth                 text,
  doctor_name           text,
  clinic_name           text,
  total_amount          numeric(14,2) not null default 0,
  vat_amount            numeric(14,2) not null default 0,
  invoiced_amount       numeric(14,2) not null default 0,
  remaining_amount      numeric(14,2) not null default 0,
  debt_cancelled        boolean not null default false,
  is_disabled           boolean not null default false,
  agreement_text        text,
  note                  text,
  user_name             text,
  migrated_agreement_id uuid references treatment_agreements(id) on delete set null,
  unique (organization_id, legacy_number)
);
create index if not exists idx_legacy_agreements_patient on legacy_agreements (patient_id, agreement_date desc);

-- ── 5) المواعيد ─────────────────────────────────────────────────────────────
create table if not exists legacy_appointments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  patient_id          uuid references patients(id) on delete cascade,
  legacy_id           bigint not null,
  file_number         bigint,
  patient_name        text,
  mobile              text,
  starts_at           timestamptz,
  ends_at             timestamptz,
  doctor_name         text,
  status              text,
  notes               text,
  added_by            text,
  registered_at       timestamptz,
  unique (organization_id, legacy_id)
);
create index if not exists idx_legacy_appointments_patient on legacy_appointments (patient_id, starts_at desc);
create index if not exists idx_legacy_appointments_start on legacy_appointments (organization_id, starts_at);

-- ── 6) السجلّات السريرية: ملاحظات الملف، زيارات الجلدية، زيارات الأسنان ─────
create table if not exists legacy_patient_records (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  patient_id          uuid references patients(id) on delete cascade,
  file_number         bigint,
  patient_name        text,
  kind                text not null check (kind in ('note', 'visit', 'dental_visit')),
  recorded_at         timestamptz,
  clinic_name         text,
  doctor_name         text,
  user_name           text,
  title               text,
  complaint           text,
  diagnosis           text,
  procedure_text      text,
  tooth               text,
  details             text,
  is_disabled         boolean not null default false,
  source_ref          text,
  -- زيارة أسنان رُبطت بمريضها بالاسم (تقرير Kizen بلا رقم ملف): يُذكر كيف
  match_method        text
);
create index if not exists idx_legacy_records_patient on legacy_patient_records (patient_id, recorded_at desc);

-- ── 7) الحماية: قراءة فقط، وبالصلاحية ──────────────────────────────────────
alter table legacy_invoices        enable row level security;
alter table legacy_invoice_items   enable row level security;
alter table legacy_receipts        enable row level security;
alter table legacy_agreements      enable row level security;
alter table legacy_appointments    enable row level security;
alter table legacy_patient_records enable row level security;

drop policy if exists legacy_invoices_read on legacy_invoices;
create policy legacy_invoices_read on legacy_invoices for select to authenticated
  using (app_has_permission(organization_id, 'billing.view'));

drop policy if exists legacy_invoice_items_read on legacy_invoice_items;
create policy legacy_invoice_items_read on legacy_invoice_items for select to authenticated
  using (app_has_permission(organization_id, 'billing.view'));

drop policy if exists legacy_receipts_read on legacy_receipts;
create policy legacy_receipts_read on legacy_receipts for select to authenticated
  using (app_has_permission(organization_id, 'billing.view'));

drop policy if exists legacy_agreements_read on legacy_agreements;
create policy legacy_agreements_read on legacy_agreements for select to authenticated
  using (app_has_permission(organization_id, 'patients.view'));

drop policy if exists legacy_appointments_read on legacy_appointments;
create policy legacy_appointments_read on legacy_appointments for select to authenticated
  using (app_has_permission(organization_id, 'patients.view'));

-- الملاحظات للجميع ممن يرى الملف، والزيارات السريرية لمن يرى الطبّيّ
drop policy if exists legacy_patient_records_read on legacy_patient_records;
create policy legacy_patient_records_read on legacy_patient_records for select to authenticated
  using (
    case when kind = 'note' then app_has_permission(organization_id, 'patients.view')
         else app_has_permission(organization_id, 'patients.view_medical') end
  );

revoke all on legacy_invoices, legacy_invoice_items, legacy_receipts, legacy_agreements,
              legacy_appointments, legacy_patient_records from anon, authenticated;
grant select on legacy_invoices, legacy_invoice_items, legacy_receipts, legacy_agreements,
                legacy_appointments, legacy_patient_records to authenticated;

-- ── 8) ملخّص الأرشيف لكلّ مريض ─────────────────────────────────────────────
create or replace view v_legacy_patient_summary
with (security_invoker = on) as
select p.id as patient_id,
       p.organization_id,
       (select count(*) from legacy_invoices i where i.patient_id = p.id)           as invoices_count,
       (select coalesce(sum(i.net_amount), 0) from legacy_invoices i where i.patient_id = p.id) as invoices_net,
       (select coalesce(sum(i.remaining_amount), 0) from legacy_invoices i
         where i.patient_id = p.id and i.settled_at is null)                        as open_balance,
       (select count(*) from legacy_agreements a where a.patient_id = p.id)         as agreements_count,
       (select count(*) from legacy_appointments a where a.patient_id = p.id)       as appointments_count,
       (select count(*) from legacy_patient_records r where r.patient_id = p.id)    as records_count
  from patients p;

grant select on v_legacy_patient_summary to authenticated;

-- ── 9) تسوية متبقٍّ قديم ────────────────────────────────────────────────────
--
-- التحصيل نفسه سند قبضٍ عاديّ في الصندوق. هذه الدالّة تُعلّم الفاتورة
-- القديمة «سُوّيت» وتحفظ من سوّاها ومتى ولماذا — ولا تُعاد: تسويةٌ خاطئة
-- تُلغى بـ`p_undo` بسببٍ مكتوب، ويبقى الأثر في سجلّ التدقيق.
create or replace function app_settle_legacy_invoice(
  p_legacy_invoice_id uuid,
  p_note              text,
  p_undo              boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv legacy_invoices%rowtype;
begin
  select * into v_inv from legacy_invoices where id = p_legacy_invoice_id for update;
  if v_inv.id is null then
    raise exception 'الفاتورة القديمة غير موجودة';
  end if;
  if not app_has_permission(v_inv.organization_id, 'cashier.receive') then
    raise exception 'صلاحيتك لا تسمح بتسوية المتبقّي (cashier.receive)';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'اكتب رقم سند القبض أو سبب التسوية';
  end if;

  if p_undo then
    if v_inv.settled_at is null then
      raise exception 'الفاتورة غير مسوّاة';
    end if;
    update legacy_invoices
       set settled_at = null, settled_by = null, settle_note = null
     where id = v_inv.id;
  else
    if v_inv.remaining_amount = 0 then
      raise exception 'لا متبقٍّ على هذه الفاتورة';
    end if;
    if v_inv.settled_at is not null then
      raise exception 'سُوّيت هذه الفاتورة سلفًا';
    end if;
    update legacy_invoices
       set settled_at = now(), settled_by = auth.uid(), settle_note = btrim(p_note)
     where id = v_inv.id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_inv.organization_id, auth.uid(), 'billing', 'update', v_inv.id,
          case when p_undo then 'إلغاء تسوية فاتورة Kizen #' else 'تسوية متبقّي فاتورة Kizen #' end
            || v_inv.legacy_number,
          format('المتبقي %s — %s', v_inv.remaining_amount, btrim(p_note)));
end $$;

revoke all on function app_settle_legacy_invoice(uuid, text, boolean) from public, anon;
grant execute on function app_settle_legacy_invoice(uuid, text, boolean) to authenticated;

commit;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
declare v_missing text;
begin
  select string_agg(t, '، ') into v_missing
    from unnest(array['legacy_invoices', 'legacy_invoice_items', 'legacy_receipts', 'legacy_agreements',
                      'legacy_appointments', 'legacy_patient_records']) t
   where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'جداول ناقصة: %', v_missing;
  end if;
  raise notice '0194 ✓ أرشيف النظام السابق جاهز';
end $$;
