-- ---------------------------------------------------------------------------
-- 0092 — الضريبة والفاتورة الإلكترونية
-- ---------------------------------------------------------------------------
-- المرحلة الثانية عشرة. تعتمد على 0091 لأن الضريبة تُبنى على فاتورة مستقرّة.
--
-- **الحصر أوّلًا:** موجود بالفعل —
--   • `organization_vat_settings` — إعدادات غنية للضريبة.
--   • `zatca_companies` — الاسم والرقم الضريبي والبيئة وإعداد الشهادة.
--   • `app_resolve_vat_rate` — تحسم النسبة والإعفاء لكل صنف ومشترٍ.
--   • `app_zatca_tlv` و`app_sales_invoice_zatca_qr` — رمز QR بصيغة TLV.
--   • `v_vat_statement_sales_invoices` و`v_vat_statement_vouchers`.
--
-- فلا جدول ضريبيّ بديل هنا. الجديد `einvoice_documents` وحده — طبقة الإرسال
-- التي لا نظير لها.
--
-- ما كان مكسورًا أو ناقصًا:
--
--   1) **رقم الفاتورة مشترك بين المنشآت.** `invoice_number` يأخذ قيمته من
--      `nextval('sales_invoices_invoice_number_seq')` — تسلسل **واحد لكل
--      القاعدة**. فمنشأتان على النظام نفسه تقتسمان سلسلة واحدة، وتظهر عند كل
--      منهما فجوات لا تفسير لها (١، ٤، ٧…) — وهو ما ترفضه أيّ مراجعة ضريبية،
--      إذ التسلسل دليلُ عدم الحذف.
--   2) **حساب الضريبة مكرَّر.** `app_resolve_vat_rate` تحسم النسبة والإعفاء
--      بقواعد المنشأة وجنسية المريض وفئة الصنف، و`app_create_invoice_from_visit`
--      (التي كتبتُها في 0091) كانت تحسبها بنفسها من `is_vat_exempt` وحده.
--      منطقان لغرض واحد يفترقان: إعفاء الجنسية لا يُطبَّق في فاتورة الزيارة.
--   3) **لا أنواع مستندات.** لا فاتورة مبسّطة ولا إشعار دائن ولا مدين — بينما
--      المرتجع موجود بلا ربط بأصله ولا سبب.
--   4) **لا لقطة للبائع والمشتري.** الفاتورة تقرأ اسم المنشأة ورقمها الضريبي
--      من `organizations` وقت الطباعة: تعديلهما غدًا يغيّر فواتير أمس.
--   5) **لا بيانات منشأة نظامية.** لا اسم قانوني، ولا سجل تجاري، ولا عنوان
--      وطنيّ — وكلّها إلزامية في الفاتورة الضريبية.
--   6) **لا طبقة إرسال.** رمز QR وحده لا يكفي: لا حالة، ولا محاولة، ولا
--      استجابة، ولا خطأ.
--
-- **لا شهادات إنتاج ولا إرسال حقيقي في هذه الهجرة.** البيئة الافتراضية
-- `sandbox`، والحالة الافتراضية `not_required`، ولا نداء خارجيّ واحد.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) بيانات المنشأة النظامية
-- ===========================================================================

alter table organization_vat_settings
  add column if not exists legal_name_ar        text,
  add column if not exists legal_name_en        text,
  add column if not exists cr_number            text,
  add column if not exists vat_registration_number text,
  add column if not exists vat_registration_date   date,
  add column if not exists vat_status           text not null default 'not_registered',
  add column if not exists default_vat_rate     numeric not null default 15,
  add column if not exists building_number      text,
  add column if not exists street_name          text,
  add column if not exists district             text,
  add column if not exists city                 text,
  add column if not exists postal_code          text,
  add column if not exists additional_number    text,
  add column if not exists country_code         text not null default 'SA',
  add column if not exists default_document_type text not null default 'simplified',
  add column if not exists numbering_scope      text not null default 'organization',
  add column if not exists invoice_number_prefix text,
  add column if not exists updated_by           uuid references auth.users(id);

comment on column organization_vat_settings.vat_status is
  'not_registered غير مسجَّلة، registered مسجَّلة، exempt معفاة. الفاتورة الضريبية لا تصدر إلّا لمسجَّلة.';
comment on column organization_vat_settings.numbering_scope is
  'نطاق تسلسل أرقام الفواتير: organization لكل منشأة، branch لكل فرع.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ovs_vat_status_check') then
    alter table organization_vat_settings add constraint ovs_vat_status_check
      check (vat_status in ('not_registered','registered','exempt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ovs_numbering_scope_check') then
    alter table organization_vat_settings add constraint ovs_numbering_scope_check
      check (numbering_scope in ('organization','branch'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ovs_doc_type_check') then
    alter table organization_vat_settings add constraint ovs_doc_type_check
      check (default_document_type in ('standard','simplified'));
  end if;
end $$;

-- الفروع قد تختلف عناوينها الوطنية وإن اشتركت في الرقم الضريبي.
alter table branches
  add column if not exists building_number   text,
  add column if not exists street_name       text,
  add column if not exists district          text,
  add column if not exists postal_code       text,
  add column if not exists additional_number text,
  add column if not exists cr_number         text,
  add column if not exists phone             text;

-- ===========================================================================
-- 2) الترقيم الآمن — تسلسل لكل منشأة (أو فرع)
-- ===========================================================================

create table if not exists document_number_sequences (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  branch_id       uuid references branches(id),
  document_kind   text not null,
  prefix          text,
  current_value   bigint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table document_number_sequences is
  'تسلسل مستقلّ لكل منشأة (أو فرع) ولكل نوع مستند. التسلسل المشترك يترك فجوات لا تفسير لها، والفجوة في مراجعة ضريبية تعني مستندًا محذوفًا.';

create unique index if not exists uq_doc_sequence
  on document_number_sequences (organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), document_kind);

alter table document_number_sequences enable row level security;

/**
 * الرقم التالي — آمن تحت التزامن.
 *
 * `update … returning` يقفل الصف، فطلبان متزامنان ينتظر أحدهما الآخر ولا
 * يحصلان على الرقم نفسه. لا يُستعمل `select` ثم `update`: بينهما نافذة يمرّ
 * فيها الآخر.
 */
create or replace function app_next_document_number(
  p_organization_id uuid,
  p_document_kind   text,
  p_branch_id       uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope  text;
  v_branch uuid;
  v_next   bigint;
begin
  select coalesce(numbering_scope, 'organization') into v_scope
    from organization_vat_settings where organization_id = p_organization_id;
  v_branch := case when coalesce(v_scope, 'organization') = 'branch' then p_branch_id else null end;

  insert into document_number_sequences (organization_id, branch_id, document_kind, current_value)
  values (p_organization_id, v_branch, p_document_kind, 0)
  on conflict do nothing;

  update document_number_sequences
     set current_value = current_value + 1, updated_at = now()
   where organization_id = p_organization_id
     and document_kind = p_document_kind
     and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_branch, '00000000-0000-0000-0000-000000000000'::uuid)
  returning current_value into v_next;

  if v_next is null then
    raise exception 'تعذّر توليد رقم المستند';
  end if;
  return v_next;
end;
$$;

-- ===========================================================================
-- 3) أنواع المستندات المالية
-- ===========================================================================

alter table sales_invoices
  add column if not exists document_type      text not null default 'simplified',
  add column if not exists note_type          text,
  add column if not exists note_reason        text,
  add column if not exists corrects_invoice_id uuid references sales_invoices(id),
  add column if not exists seller_snapshot    jsonb,
  add column if not exists buyer_snapshot     jsonb,
  add column if not exists document_number    bigint,
  add column if not exists document_prefix    text;

comment on column sales_invoices.document_type is
  'standard فاتورة ضريبية (للمنشآت)، simplified فاتورة ضريبية مبسّطة (للأفراد)، credit_note إشعار دائن، debit_note إشعار مدين.';
comment on column sales_invoices.seller_snapshot is
  'بيانات البائع **وقت الإصدار**: الاسم القانوني والرقم الضريبي والعنوان. تعديلها لاحقًا لا يمسّ ما صدر.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_invoices_document_type_check') then
    alter table sales_invoices add constraint sales_invoices_document_type_check check (
      document_type in ('standard','simplified','credit_note','debit_note')
    );
  end if;
  -- الإشعار يتبع أصلًا ويحمل سببه — وإلّا فهو مستند معلّق في الهواء.
  if not exists (select 1 from pg_constraint where conname = 'sales_invoices_note_link_check') then
    alter table sales_invoices add constraint sales_invoices_note_link_check check (
      document_type not in ('credit_note','debit_note')
      or (corrects_invoice_id is not null and coalesce(btrim(note_reason), '') <> '')
    ) not valid;
  end if;
end $$;

create index if not exists idx_invoices_corrects on sales_invoices (corrects_invoice_id)
  where corrects_invoice_id is not null;

-- ===========================================================================
-- 4) محرك الضريبة — مصدر واحد للحساب
-- ===========================================================================

alter table items
  add column if not exists vat_category      text not null default 'standard',
  add column if not exists vat_exempt_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_vat_category_check') then
    alter table items add constraint items_vat_category_check check (
      vat_category in ('standard','zero_rated','exempt','out_of_scope')
    );
  end if;
end $$;

-- الأصناف المعلَّمة معفاة تُرحَّل إلى الفئة الصحيحة.
update items set vat_category = 'exempt'
 where is_vat_exempt and vat_category = 'standard';

/**
 * الضريبة لبندٍ واحد — **المصدر الوحيد للحساب**.
 *
 * تبني على `app_resolve_vat_rate` (0031) ولا تُعيد منطقها: تلك تحسم النسبة
 * والإعفاء بقواعد المنشأة وجنسية المريض وفئة الصنف، وهذه تضيف فئة الضريبة
 * وسببها وتحسب الوعاء والمبلغ.
 *
 * قبلها كانت `app_create_invoice_from_visit` تحسب الضريبة بنفسها من
 * `is_vat_exempt` وحده — فإعفاء الجنسية لا يُطبَّق في فاتورة الزيارة ويُطبَّق
 * في فاتورة الاستقبال. رقمان لفاتورةٍ واحدة بحسب الشاشة التي أنشأتها.
 */
create or replace function app_compute_line_tax(
  p_organization_id uuid,
  p_item_id         uuid,
  p_patient_id      uuid,
  p_unit_price      numeric,
  p_qty             numeric default 1,
  p_discount        numeric default 0
)
returns table (
  vat_category text, vat_rate numeric, taxable_base numeric,
  vat_amount numeric, line_total numeric, exemption_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate    numeric;
  v_exempt  boolean;
  v_item    items%rowtype;
  v_base    numeric;
begin
  -- البند بلا صنف حقيقيّ في الفاتورة: **الباقة** كوحدة، والبند اليدويّ المسموح
  -- بصلاحية `billing.manual_line`. رفضُه هنا يدفع كل مسار منها إلى حساب ضريبته
  -- بنفسه — وهو بالضبط ازدواج منطق الضريبة الذي تُوحّده هذه المرحلة. والبند
  -- بلا صنف **خاضع بنسبة المنشأة**: لا إعفاء بلا صنفٍ يحمل سببه، لأن الإعفاء
  -- الصامت أخطر من الاحتساب الزائد.
  if p_item_id is not null then
    select * into v_item from items where id = p_item_id;
    -- معرّفٌ لا يقابله صنف ما زال خطأً: الصمت هنا يُخفي بندًا فاسدًا
    if v_item.id is null then raise exception 'الصنف غير موجود'; end if;
  end if;

  select r.vat_rate, r.is_exempt into v_rate, v_exempt
    from app_resolve_vat_rate(p_organization_id, p_item_id, p_patient_id) r;

  v_base := round(greatest(coalesce(p_unit_price, 0) * coalesce(p_qty, 1)
                           - coalesce(p_discount, 0), 0), 2);

  vat_category := case
    when v_exempt and v_item.vat_category = 'standard' then 'exempt'
    else coalesce(v_item.vat_category, 'standard')
  end;

  vat_rate := case when vat_category = 'standard' then coalesce(v_rate, 0) else 0 end;
  taxable_base := v_base;
  vat_amount   := round(v_base * vat_rate / 100, 2);
  line_total   := v_base + vat_amount;
  exemption_reason := case
    when vat_category = 'standard' then null
    else coalesce(nullif(btrim(v_item.vat_exempt_reason), ''),
                  case vat_category
                    when 'exempt'        then 'صنف معفى من ضريبة القيمة المضافة'
                    when 'zero_rated'    then 'خاضع لنسبة الصفر'
                    else 'خارج نطاق الضريبة' end)
  end;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.1) فاتورة الزيارة تستعمل المحرّك الواحد
-- ---------------------------------------------------------------------------
--
-- يُرقَّع الجزء الحاسب فقط من `app_create_invoice_from_visit` (0091): كتلتا
-- الحساب اليدويّ تُستبدلان بنداء `app_compute_line_tax`.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_invoice_from_visit';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_def := replace(v_def, chr(13), '');

  if v_def is null then
    raise exception 'app_create_invoice_from_visit غير موجودة — شغّل 0091 أوّلًا';
  end if;

  if v_def like '%app_compute_line_tax%' then
    return;  -- مُرقَّعة سلفًا
  end if;

  v_def := replace(v_def,
    replace($q$    v_cat      := case when v_src.is_vat_exempt then 'exempt' else 'standard' end;
    v_vat_rate := case when v_cat = 'exempt' then 0
                       else coalesce(v_src.vat_rate_override,
                                     (select default_vat_rate from organizations
                                       where id = v_visit.organization_id), 15) end;
    v_vat_amt  := round(v_amount * v_vat_rate / 100, 2);$q$, chr(13), ''),
    replace($q$    select t.vat_category, t.vat_rate, t.vat_amount, t.exemption_reason
      into v_cat, v_vat_rate, v_vat_amt, v_exempt_reason
      from app_compute_line_tax(v_visit.organization_id, v_src.item_id,
                                v_visit.patient_id,
                                coalesce(nullif(v_src.unit_price, 0), v_price.price, 0),
                                coalesce(v_src.qty, 1), 0) t;$q$, chr(13), ''));

  v_def := replace(v_def,
    replace($q$    v_cat      := case when v_src.is_vat_exempt then 'exempt' else 'standard' end;
    v_vat_rate := case when v_cat = 'exempt' then 0
                       else coalesce(v_src.vat_rate_override,
                                     (select default_vat_rate from organizations
                                       where id = v_visit.organization_id), 15) end;
    v_vat_amt  := round(v_amount * v_vat_rate / 100, 2);

    v_pat := v_amount; v_ins := 0;$q$, chr(13), ''),
    replace($q$    select t.vat_category, t.vat_rate, t.vat_amount, t.exemption_reason
      into v_cat, v_vat_rate, v_vat_amt, v_exempt_reason
      from app_compute_line_tax(v_visit.organization_id, v_src.item_id,
                                v_visit.patient_id, coalesce(v_src.unit_price, 0),
                                coalesce(v_src.qty, 1), 0) t;

    v_pat := v_amount; v_ins := 0;$q$, chr(13), ''));

  -- سبب الإعفاء يأتي من المحرّك لا من نصّ ثابت
  v_def := replace(v_def,
    replace($q$      case when v_cat = 'standard' then null
           else 'صنف معلَّم معفى في الكتالوج' end,$q$, chr(13), ''),
    replace($q$      v_exempt_reason,$q$, chr(13), ''));
  v_def := replace(v_def,
    replace($q$            case when v_cat = 'standard' then null
                 else 'صنف معلَّم معفى في الكتالوج' end,$q$, chr(13), ''),
    replace($q$            v_exempt_reason,$q$, chr(13), ''));

  -- متغيّر جديد للسبب
  v_def := replace(v_def,
    '  v_cat      text;',
    '  v_cat      text;' || chr(10) || '  v_exempt_reason text;');

  if v_def not like '%app_compute_line_tax%' then
    raise exception 'تعذّر ترقيع app_create_invoice_from_visit: شكلها تغيّر — راجع 0091';
  end if;

  execute v_def;
end $$;

-- ===========================================================================
-- 5) الإصدار: ترقيم، ولقطة بائع ومشترٍ
-- ===========================================================================

/**
 * لحظة الإصدار تُثبِّت ثلاثة أشياء لا تتغيّر بعدها: الرقم، وبيانات البائع،
 * وبيانات المشتري.
 *
 * قبلها كانت الفاتورة تقرأ اسم المنشأة ورقمها الضريبي وقت **الطباعة** — أي
 * أن تصحيح عنوان المنشأة غدًا يغيّر ما طُبع أمس، وهو ما تُبطله المراجعة.
 */
create or replace function app_stamp_invoice_on_issue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  organizations%rowtype;
  v_s    organization_vat_settings%rowtype;
  v_b    branches%rowtype;
  v_p    patients%rowtype;
begin
  if new.issued_at is null or old.issued_at is not null then
    return new;
  end if;

  select * into v_org from organizations where id = new.organization_id;
  select * into v_s   from organization_vat_settings where organization_id = new.organization_id;
  select * into v_b   from branches where id = new.branch_id;
  if new.patient_id is not null then
    select * into v_p from patients where id = new.patient_id;
  end if;

  -- ── الرقم
  if new.document_number is null then
    new.document_number := app_next_document_number(
      new.organization_id,
      case when new.document_type in ('credit_note','debit_note')
           then new.document_type else 'invoice' end,
      new.branch_id);
    new.document_prefix := coalesce(v_s.invoice_number_prefix,
      case new.document_type when 'credit_note' then 'CN'
                             when 'debit_note'  then 'DN'
                             else 'INV' end);
  end if;

  -- ── البائع
  new.seller_snapshot := jsonb_build_object(
    'legal_name_ar',  coalesce(v_s.legal_name_ar, v_org.name),
    'legal_name_en',  v_s.legal_name_en,
    'vat_number',     coalesce(v_s.vat_registration_number, v_org.tax_number),
    'cr_number',      coalesce(v_b.cr_number, v_s.cr_number),
    'vat_status',     coalesce(v_s.vat_status, 'not_registered'),
    'branch_name',    v_b.name,
    'address', jsonb_build_object(
      'building_number',   coalesce(v_b.building_number, v_s.building_number),
      'street_name',       coalesce(v_b.street_name, v_s.street_name),
      'district',          coalesce(v_b.district, v_s.district),
      'city',              coalesce(v_b.city, v_s.city),
      'postal_code',       coalesce(v_b.postal_code, v_s.postal_code),
      'additional_number', coalesce(v_b.additional_number, v_s.additional_number),
      'country_code',      coalesce(v_s.country_code, 'SA')));

  -- ── المشتري
  new.buyer_snapshot := case
    when v_p.id is not null then jsonb_build_object(
      'name',        v_p.name_ar,
      'file_number', v_p.file_number,
      'id_number',   v_p.id_number,
      'phone',       v_p.mobile_number)
    else jsonb_build_object(
      'name',       new.external_customer_name,
      'id_number',  new.id_number,
      'phone',      new.external_customer_mobile,
      'vat_number', null)
  end;

  -- الفاتورة الضريبية (المعيارية) تشترط رقم المشتري الضريبي أو هويته؛
  -- والمبسّطة لا تشترط. فمن أصدر معيارية بلا مشترٍ معرَّف أصدر مستندًا ناقصًا.
  if new.document_type = 'standard'
     and coalesce(new.buyer_snapshot->>'id_number', '') = ''
     and coalesce(new.buyer_snapshot->>'vat_number', '') = '' then
    raise exception 'الفاتورة الضريبية تحتاج رقم هوية المشتري أو رقمه الضريبي — أو أصدرها مبسّطة';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stamp_invoice_on_issue on sales_invoices;
create trigger trg_stamp_invoice_on_issue
  before update on sales_invoices
  for each row execute function app_stamp_invoice_on_issue();

-- الفاتورة الصادرة لا تُحذف — ولا حتى بأمر مباشر.
create or replace function app_block_issued_invoice_delete()
returns trigger
language plpgsql
as $$
begin
  if old.issued_at is not null then
    raise exception 'الفاتورة الصادرة لا تُحذف — ألغِها أو أصدر إشعارًا دائنًا';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_block_issued_invoice_delete on sales_invoices;
create trigger trg_block_issued_invoice_delete before delete on sales_invoices
  for each row execute function app_block_issued_invoice_delete();

-- ---------------------------------------------------------------------------
-- 5.1) الإشعار الدائن والمدين
-- ---------------------------------------------------------------------------
create or replace function app_create_credit_note(
  p_invoice_id uuid,
  p_reason     text,
  p_lines      jsonb default null,   -- [{"invoice_item_id":"…","qty":1}] أو null للكل
  p_note_type  text default 'credit_note'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv   sales_invoices%rowtype;
  v_note  uuid;
  v_line  record;
  v_qty   numeric;
  v_sub   numeric := 0;
  v_vat   numeric := 0;
  v_n     int := 0;
begin
  select * into v_inv from sales_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if not app_has_permission(v_inv.organization_id, 'billing.refund') then
    raise exception 'صلاحيتك لا تسمح بإصدار الإشعارات (billing.refund)';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'الإشعار يحتاج سببًا مكتوبًا';
  end if;
  if v_inv.issued_at is null then
    raise exception 'الإشعار يصدر على فاتورة صادرة — عدّل المسوّدة مباشرةً';
  end if;
  if p_note_type not in ('credit_note','debit_note') then
    raise exception 'نوع الإشعار غير معروف';
  end if;

  insert into sales_invoices (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, visit_id,
    invoice_type, document_type, status, corrects_invoice_id, note_type, note_reason,
    external_customer_name, id_number, is_insurance_invoice, created_by)
  values (
    v_inv.organization_id, v_inv.branch_id, v_inv.clinic_id, v_inv.doctor_id,
    v_inv.patient_id, v_inv.visit_id,
    case when p_note_type = 'credit_note' then 'return' else 'sale' end,
    p_note_type, 'draft', p_invoice_id, p_note_type, btrim(p_reason),
    v_inv.external_customer_name, v_inv.id_number, v_inv.is_insurance_invoice, auth.uid())
  returning id into v_note;

  for v_line in
    select li.*, coalesce((
             select (e->>'qty')::numeric from jsonb_array_elements(p_lines) e
              where (e->>'invoice_item_id')::uuid = li.id), li.qty) as take_qty
      from sales_invoice_items li
     where li.invoice_id = p_invoice_id
       and (p_lines is null
            or li.id in (select (e->>'invoice_item_id')::uuid
                           from jsonb_array_elements(p_lines) e))
  loop
    v_qty := least(coalesce(v_line.take_qty, v_line.qty), v_line.qty);
    continue when coalesce(v_qty, 0) <= 0;

    insert into sales_invoice_items (
      invoice_id, item_id, doctor_id, description, line_type, price, qty,
      vat_rate, vat_amount, net_amount, vat_category, exemption_reason,
      taxable_base, item_name_snapshot, unit_snapshot, source_type)
    values (
      v_note, v_line.item_id, v_line.doctor_id, v_line.description, v_line.line_type,
      v_line.price, v_qty,
      v_line.vat_rate, round(v_line.price * v_qty * coalesce(v_line.vat_rate,0) / 100, 2),
      round(v_line.price * v_qty * (1 + coalesce(v_line.vat_rate,0) / 100), 2),
      v_line.vat_category, v_line.exemption_reason,
      round(v_line.price * v_qty, 2), v_line.item_name_snapshot, v_line.unit_snapshot,
      'manual');

    v_sub := v_sub + round(v_line.price * v_qty, 2);
    v_vat := v_vat + round(v_line.price * v_qty * coalesce(v_line.vat_rate,0) / 100, 2);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'لا بنود في الإشعار';
  end if;

  update sales_invoices
     set subtotal_amount = v_sub, vat_amount = v_vat, net_amount = v_sub + v_vat,
         document_type = p_note_type
   where id = v_note;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_inv.organization_id, auth.uid(), 'billing', 'add', v_note,
          case when p_note_type = 'credit_note' then 'إشعار دائن' else 'إشعار مدين' end,
          format('على الفاتورة %s بـ%s بندًا', v_inv.document_number, v_n), btrim(p_reason));

  return v_note;
end;
$$;

-- ===========================================================================
-- 6) طبقة الفاتورة الإلكترونية — بيانات بلا إرسال
-- ===========================================================================

create table if not exists einvoice_documents (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  sales_invoice_id  uuid not null references sales_invoices(id),
  document_type     text not null,
  environment       text not null default 'sandbox'
                      check (environment in ('sandbox','simulation','production')),
  status            text not null default 'not_required'
                      check (status in ('not_required','pending','generated','submitted',
                                        'accepted','warning','rejected','failed')),
  invoice_hash      text,
  previous_hash     text,
  uuid_value        uuid default gen_random_uuid(),
  qr_code           text,
  xml_payload       text,
  request_payload   jsonb,
  response_payload  jsonb,
  validation_errors jsonb,
  warnings          jsonb,
  attempt_count     integer not null default 0,
  last_attempt_at   timestamptz,
  submitted_at      timestamptz,
  responded_at      timestamptz,
  cleared_at        timestamptz,
  reported_at       timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

comment on table einvoice_documents is
  'مستند الفاتورة الإلكترونية: الحالة والمحاولات والاستجابة. **لا تكامل ولا إرسال في 0092** — البيئة الافتراضية sandbox والحالة not_required.';
comment on column einvoice_documents.previous_hash is
  'تجزئة المستند السابق — سلسلة التجزئة هي ما يثبت عدم حذف مستند من الوسط.';

create unique index if not exists uq_einvoice_per_invoice
  on einvoice_documents (sales_invoice_id);
create index if not exists idx_einvoice_status
  on einvoice_documents (organization_id, status, created_at desc);

alter table einvoice_documents enable row level security;

/**
 * توليد مستند إلكتروني للفاتورة.
 *
 * **لا يُرسل شيئًا.** يجمع البيانات، ويحسب رمز QR بصيغة TLV من لقطة البائع
 * (لا من `organizations` الحيّة)، ويربط التجزئة بسابقتها، ويترك الحالة
 * `generated`. الإرسال قرار لاحق يحتاج شهادات إنتاج لم تُعتمد بعد.
 */
create or replace function app_generate_einvoice(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv   sales_invoices%rowtype;
  v_prev  text;
  v_id    uuid;
  v_qr    text;
  v_name  text;
  v_vat   text;
  v_hash  text;
begin
  select * into v_inv from sales_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if not app_has_permission(v_inv.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بتوليد المستند (billing.issue)';
  end if;
  if v_inv.issued_at is null then
    raise exception 'المستند الإلكتروني يصدر بعد إصدار الفاتورة';
  end if;

  v_name := coalesce(v_inv.seller_snapshot->>'legal_name_ar', '');
  v_vat  := coalesce(v_inv.seller_snapshot->>'vat_number', '');

  if v_vat = '' then
    raise exception 'المنشأة بلا رقم ضريبي في لقطة الفاتورة — أكمل الإعدادات الضريبية';
  end if;

  v_qr := replace(replace(encode(
      app_zatca_tlv(1, v_name)
   || app_zatca_tlv(2, v_vat)
   || app_zatca_tlv(3, to_char(coalesce(v_inv.issued_at, v_inv.created_at) at time zone 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   || app_zatca_tlv(4, to_char(coalesce(v_inv.net_amount, 0), 'FM999999999990.00'))
   || app_zatca_tlv(5, to_char(coalesce(v_inv.vat_amount, 0), 'FM999999999990.00')),
    'base64'), e'\n', ''), e'\r', '');

  select e.invoice_hash into v_prev
    from einvoice_documents e
   where e.organization_id = v_inv.organization_id and e.invoice_hash is not null
   order by e.created_at desc limit 1;

  v_hash := encode(sha256(convert_to(
    coalesce(v_prev, '') || v_inv.id::text || coalesce(v_inv.net_amount, 0)::text
    || coalesce(v_inv.vat_amount, 0)::text || coalesce(v_inv.issued_at::text, ''), 'UTF8')), 'hex');

  insert into einvoice_documents (
    organization_id, sales_invoice_id, document_type, status,
    qr_code, invoice_hash, previous_hash, created_by,
    request_payload)
  values (
    v_inv.organization_id, p_invoice_id, v_inv.document_type, 'generated',
    v_qr, v_hash, v_prev, auth.uid(),
    jsonb_build_object(
      'document_number', v_inv.document_number,
      'document_type',   v_inv.document_type,
      'issued_at',       v_inv.issued_at,
      'seller',          v_inv.seller_snapshot,
      'buyer',           v_inv.buyer_snapshot,
      'totals', jsonb_build_object(
        'subtotal', v_inv.subtotal_amount, 'discount', v_inv.discount_amount,
        'vat', v_inv.vat_amount, 'net', v_inv.net_amount),
      'lines', (select jsonb_agg(jsonb_build_object(
                  'name', li.item_name_snapshot, 'qty', li.qty, 'price', li.price,
                  'vat_category', li.vat_category, 'vat_rate', li.vat_rate,
                  'vat_amount', li.vat_amount, 'taxable_base', li.taxable_base,
                  'exemption_reason', li.exemption_reason))
                  from sales_invoice_items li where li.invoice_id = p_invoice_id)))
  on conflict (sales_invoice_id) do update set
    qr_code = excluded.qr_code,
    request_payload = excluded.request_payload,
    status = case when einvoice_documents.status in ('accepted','submitted')
                  then einvoice_documents.status else 'generated' end,
    updated_at = now()
  returning id into v_id;

  update sales_invoices set zatca_qr = v_qr where id = p_invoice_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_inv.organization_id, auth.uid(), 'billing', 'add', v_id,
          'مستند إلكتروني', format('تُوِّلد للفاتورة %s', v_inv.document_number));

  return v_id;
end;
$$;

create or replace function app_set_einvoice_status(
  p_document_id uuid,
  p_status      text,
  p_response    jsonb default null,
  p_errors      jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_d einvoice_documents%rowtype;
begin
  select * into v_d from einvoice_documents where id = p_document_id for update;
  if v_d.id is null then raise exception 'المستند غير موجود'; end if;
  if not app_has_permission(v_d.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بتحديث المستند (billing.issue)';
  end if;
  if p_status not in ('not_required','pending','generated','submitted',
                      'accepted','warning','rejected','failed') then
    raise exception 'حالة غير معروفة: %', p_status;
  end if;
  -- المقبول نهائيّ: تغييره بعد قبول الهيئة يعني اختلاف سجلّنا عن سجلّها.
  if v_d.status = 'accepted' and p_status <> 'accepted' then
    raise exception 'المستند مقبول لدى الهيئة — لا يُغيَّر';
  end if;

  update einvoice_documents set
    status            = p_status,
    response_payload  = coalesce(p_response, response_payload),
    validation_errors = coalesce(p_errors, validation_errors),
    attempt_count     = case when p_status in ('submitted','failed','rejected')
                             then attempt_count + 1 else attempt_count end,
    last_attempt_at   = case when p_status in ('submitted','failed','rejected')
                             then now() else last_attempt_at end,
    submitted_at      = case when p_status = 'submitted' then now() else submitted_at end,
    responded_at      = case when p_status in ('accepted','warning','rejected','failed')
                             then now() else responded_at end,
    cleared_at        = case when p_status = 'accepted' then now() else cleared_at end,
    updated_at        = now()
  where id = p_document_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_d.organization_id, auth.uid(), 'billing', 'update', p_document_id,
          'مستند إلكتروني', format('%s ← %s', v_d.status, p_status));
end;
$$;

-- ===========================================================================
-- 7) الأذونات وRLS
-- ===========================================================================
do $$
declare r record; pol record;
begin
  for r in
    select * from (values
      ('einvoice_documents',        'billing.view', 'billing.issue'),
      ('document_number_sequences', 'billing.view', 'billing.issue')
    ) as v(t, pv, pw)
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy if exists %I on %I', pol.policyname, r.t);
    end loop;
    execute format(
      'create policy %I on %I for select using (app_has_permission(organization_id, %L))',
      r.t || '_select', r.t, r.pv);
    execute format(
      'create policy %I on %I for insert with check (app_has_permission(organization_id, %L))',
      r.t || '_insert', r.t, r.pw);
    execute format(
      'create policy %I on %I for update using (app_has_permission(organization_id, %L))',
      r.t || '_update', r.t, r.pw);
  end loop;
end $$;

grant select, insert, update on einvoice_documents, document_number_sequences to authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_next_document_number','app_compute_line_tax',
                         'app_create_credit_note','app_generate_einvoice',
                         'app_set_einvoice_status')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 8) المناظير
-- ===========================================================================

create or replace view v_tax_invoice_lines
with (security_invoker = on) as
select
  li.id, li.invoice_id, i.organization_id, i.document_number, i.document_type,
  i.issued_at, i.status as invoice_status,
  li.item_name_snapshot, li.unit_snapshot, li.qty, li.price,
  li.discount_amount, li.taxable_base, li.vat_category, li.vat_rate,
  li.vat_amount, li.net_amount, li.exemption_reason,
  i.seller_snapshot->>'vat_number' as seller_vat_number,
  i.buyer_snapshot->>'name'        as buyer_name
from sales_invoice_items li
join sales_invoices i on i.id = li.invoice_id;

create or replace view v_vat_summary
with (security_invoker = on) as
select
  i.organization_id,
  i.branch_id,
  date_trunc('month', i.issued_at)::date as period_month,
  i.document_type,
  li.vat_category,
  count(distinct i.id)              as invoice_count,
  sum(li.taxable_base)              as taxable_amount,
  sum(li.vat_amount)                as vat_amount,
  sum(li.taxable_base + li.vat_amount) as total_amount
from sales_invoices i
join sales_invoice_items li on li.invoice_id = i.id
where i.issued_at is not null and i.status <> 'void'
group by i.organization_id, i.branch_id, date_trunc('month', i.issued_at),
         i.document_type, li.vat_category;

comment on view v_vat_summary is
  'إقرار الضريبة: الوعاء والضريبة شهريًا حسب نوع المستند وفئة الضريبة — لا رقمًا واحدًا مجملًا.';

create or replace view v_einvoice_status
with (security_invoker = on) as
select
  e.id, e.organization_id, e.sales_invoice_id, e.status, e.environment,
  e.attempt_count, e.last_attempt_at, e.submitted_at, e.responded_at,
  e.validation_errors, e.qr_code is not null as has_qr,
  i.document_number, i.document_type, i.issued_at, i.net_amount, i.vat_amount,
  p.name_ar as patient_name,
  (e.status in ('rejected','failed')) as needs_attention
from einvoice_documents e
join sales_invoices i on i.id = e.sales_invoice_id
left join patients p on p.id = i.patient_id;

grant select on v_tax_invoice_lines, v_vat_summary, v_einvoice_status to authenticated;

-- ===========================================================================
-- 9) فحص ذاتي
-- ===========================================================================
do $$
begin
  if (select pg_get_functiondef(oid) from pg_proc
       where proname = 'app_create_invoice_from_visit' limit 1)
     not like '%app_compute_line_tax%' then
    raise exception 'فاتورة الزيارة ما زالت تحسب الضريبة بمنطقها الخاص';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_doc_sequence') then
    raise exception 'تسلسل الترقيم لكل منشأة غير مركَّب';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_block_issued_invoice_delete') then
    raise exception 'منع حذف الفاتورة الصادرة غير مركَّب';
  end if;
  -- لا شهادات إنتاج
  if exists (select 1 from einvoice_documents where environment = 'production') then
    raise exception 'وُجد مستند ببيئة إنتاج — هذه الهجرة لا تُفعّل الإنتاج';
  end if;
end $$;
