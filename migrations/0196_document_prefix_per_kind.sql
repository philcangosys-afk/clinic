-- ============================================================================
-- 0196 — بادئة مستقلّة للإشعار الدائن والمدين
-- ============================================================================
--
-- قبلها: كلّ المستندات المالية تأخذ بادئة واحدة (`invoice_number_prefix`)،
-- فالفاتورة C-10096 والإشعار الدائن رقم 28 يُطبعان C-10096 وC-28 — والرقم
-- C-28 هو نفسه رقم فاتورةٍ قديمة من Kizen. ترقيم Kizen يفصل المرتجعات بـCR-.
--
-- بعدها: عمودان في إعدادات الضريبة، `credit_note_prefix` و`debit_note_prefix`.
-- إن كانا فارغين يبقى السلوك كما كان حرفيًّا (بادئة الفاتورة ثم CN/DN).
--
-- لا يمسّ هذا تسلسل الأرقام (`document_number_sequences`) ولا عدّاد ZATCA
-- (ICV) ولا سلسلة التجزئة (PIH): يغيّر النصّ الذي يسبق الرقم فقط، ولا يغيّر
-- مستندًا صدر — البادئة تُختم عند الإصدار وتبقى.
--
-- الدالّة منسوخة من 0092 كما هي، والتغيير في كتلة «الرقم» وحدها.
-- ============================================================================

begin;

alter table organization_vat_settings
  add column if not exists credit_note_prefix text,
  add column if not exists debit_note_prefix  text;

comment on column organization_vat_settings.credit_note_prefix is
  'بادئة الإشعار الدائن (المرتجع). فارغة = بادئة الفاتورة.';
comment on column organization_vat_settings.debit_note_prefix is
  'بادئة الإشعار المدين. فارغة = بادئة الفاتورة.';

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
    -- بادئة لكل نوع: الإشعار يأخذ بادئته إن ضُبطت، وإلّا بادئة الفاتورة
    -- كما كان قبل 0196 — فلا يتغيّر شيء لمنشأةٍ لم تضبط بادئات الإشعارات.
    new.document_prefix := case new.document_type
      when 'credit_note' then coalesce(nullif(btrim(v_s.credit_note_prefix), ''),
                                       v_s.invoice_number_prefix, 'CN')
      when 'debit_note'  then coalesce(nullif(btrim(v_s.debit_note_prefix), ''),
                                       v_s.invoice_number_prefix, 'DN')
      else coalesce(v_s.invoice_number_prefix, 'INV') end;
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

commit;
