-- ============================================================================
-- 0202 — اكتمال الربط مع ZATCA: الفاتورة المختلطة، والخصم على مستوى الفاتورة،
--        وفاتورة الأعمال (B2B) لعميلٍ خارجيّ
-- ============================================================================
--
-- ما كانت الدالّة الطرفية `zatca-invoice` ترفضه قبل الإرسال:
--   * فاتورة تجمع بنودًا بـ15% وبنودًا صفرية.
--   * فاتورة عليها خصمٌ على مستوى الفاتورة (لا على البند).
--   * فاتورة التأمين في الإنتاج.
--   * الفاتورة الضريبية (المعيارية، B2B) — كانت كلّ فاتورة تُرسل «مبسّطة».
--
-- ما يضيفه هذا الملفّ في القاعدة (والإرسال نفسه في الدالّة الطرفية):
--
--   ١) العميل الخارجيّ مشترٍ ضريبيّ: الرقم الضريبيّ، والسجلّ التجاريّ،
--      والعنوان الوطنيّ — أعمدة في `external_clients` لا جدولٌ جديد.
--   ٢) `sales_invoices.external_client_id` — مشتري فاتورة الأعمال، و
--      `document_discount_amount` — الخصم على مستوى الفاتورة وحده.
--   ٣) `zatca_exemption_code` في الصنف وفي بند الفاتورة (لقطة لحظة البيع):
--      سبب الصفرية المعتمد لدى ZATCA لبندٍ صفريّ لغير المواطن. القيمة
--      الوحيدة المقبولة الآن VATEX-SA-35 (الأدوية والمعدّات الطبية).
--      إعفاء المواطن (VATEX-SA-HEA) لا يحتاجه — يُحسب من ملفّ المريض.
--   ٤) `app_create_sales_invoice` يقبل `p_external_client_id`، ويكتب لفاتورة
--      الأعمال `document_type = 'standard'` (كان يبقى «simplified» دائمًا وإن
--      أُشّر B2B)، ويشترط لها عميلًا مكتمل البيانات، ويمنعها لمواطنٍ معفًى ولفاتورة تأمين
--      (الإعفاء الصحّي يُبلَّغ مبسّطًا باسم المواطن، والتأمين — بقرار المالك —
--      فاتورة مبسّطة واحدة للمريض بكامل المبلغ).
--   ٥) `app_apply_invoice_discount` يحسب الضريبة بعد الخصم: كان يُنقص الصافي
--      ويُبقي الضريبة على المبلغ قبل الخصم، ويمحو خصومات البنود من الرأس.
--   ٦) `app_create_credit_note` ينقل صفة الأعمال ومشتريها إلى الإشعار، ويُرجع
--      خصم البند بنسبة الكمية المرتجعة (كان يُرجع السعر كاملًا).
--   ٧) لقطة المشتري عند الإصدار تحمل بيانات العميل الخارجيّ، و`v_invoice_print`
--      يعرضها على الورقة.
--
-- الترقيعات النصّية (٤ و`app_save_service`) على نهج 0092 و0168: كلّ موضعٍ
-- يُتحقَّق منه قبل التنفيذ، وأيّ تغيّرٍ في شكل الدالّة يوقف الترقية كلّها.
-- آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- ١) العميل الخارجيّ — هويّته الضريبية وعنوانه الوطنيّ
-- ---------------------------------------------------------------------------
alter table external_clients
  add column if not exists vat_number        text,
  add column if not exists cr_number         text,
  add column if not exists building_number   text,
  add column if not exists street_name       text,
  add column if not exists district          text,
  add column if not exists city              text,
  add column if not exists postal_code       text,
  add column if not exists additional_number text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'external_clients_vat_number_check') then
    alter table external_clients add constraint external_clients_vat_number_check
      check (vat_number is null or vat_number ~ '^3[0-9]{13}3$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_clients_cr_number_check') then
    alter table external_clients add constraint external_clients_cr_number_check
      check (cr_number is null or cr_number ~ '^[0-9]{10}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_clients_building_number_check') then
    alter table external_clients add constraint external_clients_building_number_check
      check (building_number is null or building_number ~ '^[0-9]{4}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_clients_postal_code_check') then
    alter table external_clients add constraint external_clients_postal_code_check
      check (postal_code is null or postal_code ~ '^[0-9]{5}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_clients_additional_number_check') then
    alter table external_clients add constraint external_clients_additional_number_check
      check (additional_number is null or additional_number ~ '^[0-9]{4}$');
  end if;
end $$;

comment on column external_clients.vat_number is
  'الرقم الضريبيّ للعميل (15 رقمًا يبدأ وينتهي بـ3) — مشتري فاتورة الأعمال (B2B). 0202.';
comment on column external_clients.cr_number is
  'السجلّ التجاريّ (10 أرقام) — يكفي بدل الرقم الضريبيّ لمنشأة غير مسجّلة في الضريبة. 0202.';

-- ---------------------------------------------------------------------------
-- ٢) الفاتورة: مشتري الأعمال، والخصم على مستوى الفاتورة
-- ---------------------------------------------------------------------------
alter table sales_invoices
  add column if not exists external_client_id       uuid,
  add column if not exists document_discount_amount numeric(14,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_invoices_external_client_tenant_fk') then
    alter table sales_invoices add constraint sales_invoices_external_client_tenant_fk
      foreign key (organization_id, external_client_id)
      references external_clients (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_invoices_document_discount_check') then
    alter table sales_invoices add constraint sales_invoices_document_discount_check
      check (document_discount_amount >= 0);
  end if;
end $$;

create index if not exists idx_sales_invoices_external_client
  on sales_invoices (external_client_id) where external_client_id is not null;

comment on column sales_invoices.external_client_id is
  'مشتري فاتورة الأعمال (B2B) — عميلٌ خارجيّ بهويّته الضريبية. المريض (إن وُجد) متلقّي الخدمة لا المشتري. 0202.';
comment on column sales_invoices.document_discount_amount is
  'الخصم على مستوى الفاتورة وحده. `discount_amount` = خصومات البنود + هذا. يُبلَّغ ZATCA خصمًا على المستند موزّعًا على فئات الضريبة بنسبة أوعيتها. 0202.';

-- ---------------------------------------------------------------------------
-- ٣) سبب الصفرية المعتمد لدى ZATCA — في الصنف وفي البند
-- ---------------------------------------------------------------------------
alter table items
  add column if not exists zatca_exemption_code text;
alter table sales_invoice_items
  add column if not exists zatca_exemption_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_zatca_exemption_code_check') then
    alter table items add constraint items_zatca_exemption_code_check
      check (zatca_exemption_code is null or zatca_exemption_code in ('VATEX-SA-35'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sii_zatca_exemption_code_check') then
    alter table sales_invoice_items add constraint sii_zatca_exemption_code_check
      check (zatca_exemption_code is null or zatca_exemption_code in ('VATEX-SA-35'));
  end if;
end $$;

comment on column items.zatca_exemption_code is
  'سبب الصفرية لدى ZATCA حين يُباع الصنف بلا ضريبة لغير المواطن. VATEX-SA-35 = أدوية ومعدّات طبية. فارغ = لا سبب معتمد، فيُرفض إرسال البند الصفريّ لغير المواطن. 0202.';
comment on column sales_invoice_items.zatca_exemption_code is
  'لقطة `items.zatca_exemption_code` لحظة البيع للبند الصفريّ. 0202.';

/**
 * البند يرث سياق فاتورته ويلتقط لقطته لحظة الإدراج — منسوخة من 0091 كما هي،
 * ويُضاف إليها سبب الصفرية لدى ZATCA من الصنف للبند الصفريّ.
 */
create or replace function app_fill_invoice_item_context()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv  sales_invoices%rowtype;
  v_item items%rowtype;
begin
  select * into v_inv from sales_invoices where id = new.invoice_id;
  if v_inv.id is null then
    raise exception 'الفاتورة غير موجودة';
  end if;

  new.organization_id := coalesce(new.organization_id, v_inv.organization_id);
  new.branch_id       := coalesce(new.branch_id, v_inv.branch_id);
  new.patient_id      := coalesce(new.patient_id, v_inv.patient_id);
  new.visit_id        := coalesce(new.visit_id, v_inv.visit_id);
  new.source_type     := coalesce(new.source_type,
                                  case when new.visit_service_id is not null
                                       then 'visit_service' else 'manual' end);
  new.source_id       := coalesce(new.source_id, new.visit_service_id);

  if new.item_id is not null then
    select * into v_item from items where id = new.item_id;
    new.item_name_snapshot := coalesce(new.item_name_snapshot, new.description, v_item.name_ar);
    new.unit_snapshot      := coalesce(new.unit_snapshot, v_item.unit);
    -- 0202: سبب الصفرية لدى ZATCA يُلتقط مع البند الصفريّ، فتعديل الصنف غدًا
    -- لا يغيّر سبب مستندٍ صدر اليوم
    if new.zatca_exemption_code is null and coalesce(new.vat_rate, 0) = 0 then
      new.zatca_exemption_code := v_item.zatca_exemption_code;
    end if;
  else
    new.item_name_snapshot := coalesce(new.item_name_snapshot, new.description, 'بند');
  end if;

  new.taxable_base := coalesce(new.taxable_base,
    greatest(coalesce(new.price,0) * coalesce(new.qty,1) - coalesce(new.discount_amount,0), 0));

  -- بندٌ معفى بلا سبب يمرّ من مسارات قديمة كثيرة؛ يُعطى سببًا عامًّا بدل أن
  -- يُرفَض الإدراج، والمرحلة ١٢ تتيح للمستخدم سببًا دقيقًا لكل صنف.
  if new.vat_category in ('exempt','zero_rated')
     and coalesce(btrim(new.exemption_reason), '') = '' then
    new.exemption_reason := 'صنف معلَّم معفى في الكتالوج';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- ٣-ب) حفظ الصنف يكتب سبب الصفرية — ترقيع `app_save_service`
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_save_service';
  if v_def is null then
    raise exception 'app_save_service غير موجودة — نفِّذ 0077 أوّلًا';
  end if;
  v_def := replace(v_def, chr(13), '');

  if v_def like '%zatca_exemption_code%' then
    raise notice 'app_save_service: مُرقَّعة سلفًا';
    return;
  end if;

  -- قائمة أعمدة الإدراج
  v_new := regexp_replace(v_def,
    'is_vat_exempt,(\s*)is_disabled,',
    'is_vat_exempt,\1zatca_exemption_code,\1is_disabled,');
  if v_new = v_def then
    raise exception 'app_save_service: تعذّر العثور على قائمة أعمدة الإدراج';
  end if;
  v_def := v_new;

  -- قيم الإدراج
  v_new := regexp_replace(v_def,
    '(coalesce\(\(p_payload ->> ''is_vat_exempt''\)::boolean, false\),)(\s*)(coalesce\(\(p_payload ->> ''is_disabled''\)::boolean, false\))',
    '\1\2case when coalesce((p_payload ->> ''is_vat_exempt'')::boolean, false) then nullif(btrim(p_payload ->> ''zatca_exemption_code''), '''') end,\2\3');
  if v_new = v_def then
    raise exception 'app_save_service: تعذّر العثور على قيم الإدراج';
  end if;
  v_def := v_new;

  -- التحديث
  v_new := regexp_replace(v_def,
    '(is_vat_exempt = coalesce\(\(p_payload ->> ''is_vat_exempt''\)::boolean, false\),)(\s*)',
    '\1\2zatca_exemption_code = case when coalesce((p_payload ->> ''is_vat_exempt'')::boolean, false) then nullif(btrim(p_payload ->> ''zatca_exemption_code''), '''') end,\2');
  if v_new = v_def then
    raise exception 'app_save_service: تعذّر العثور على جملة التحديث';
  end if;
  v_def := v_new;

  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- ٤) `app_create_sales_invoice` — مشتري فاتورة الأعمال
-- ---------------------------------------------------------------------------
do $$
declare
  v_def   text;
  v_new   text;
  v_pos   int;
  v_block text;

  -- يستبدل نصًّا يجب أن يظهر مرّةً واحدة بالضبط، وإلّا توقّفت الترقية
  function_body_note text := 'app_create_sales_invoice';
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'app_create_sales_invoice'
                and 'p_external_client_id' = any (p.proargnames)) then
    raise notice 'app_create_sales_invoice: مُرقَّعة سلفًا';
  else
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'app_create_sales_invoice'
       and p.pronargs = 24;
    if v_def is null then
      raise exception 'app_create_sales_invoice بتوقيع 0160 (24 معاملًا) غير موجودة';
    end if;
    v_def := replace(v_def, chr(13), '');

    -- (أ) التوقيع
    if (length(v_def) - length(replace(v_def, 'p_classification_value_id uuid DEFAULT NULL::uuid)', '')))
         / length('p_classification_value_id uuid DEFAULT NULL::uuid)') <> 1 then
      raise exception '%: تعذّر العثور على التوقيع', function_body_note;
    end if;
    v_def := replace(v_def,
      'p_classification_value_id uuid DEFAULT NULL::uuid)',
      'p_classification_value_id uuid DEFAULT NULL::uuid, p_external_client_id uuid DEFAULT NULL::uuid)');

    -- (ب) شرط العميل: العميل الخارجيّ المختار يكفي اسمًا
    v_new := replace(v_def,
      'if p_patient_id is null and coalesce(btrim(p_external_customer_name),'''') = '''' then',
      'if p_patient_id is null and coalesce(btrim(p_external_customer_name),'''') = '''' and p_external_client_id is null then');
    if v_new = v_def then
      raise exception '%: تعذّر العثور على شرط المريض أو العميل', function_body_note;
    end if;
    v_def := v_new;

    -- (ج) أعمدة الإدراج وقيمها
    if (length(v_def) - length(replace(v_def, 'source_value_id, classification_value_id,', '')))
         / length('source_value_id, classification_value_id,') <> 1 then
      raise exception '%: تعذّر العثور على أعمدة الرأس', function_body_note;
    end if;
    v_def := replace(v_def,
      'source_value_id, classification_value_id,',
      'source_value_id, classification_value_id, external_client_id, document_type,');

    if (length(v_def) - length(replace(v_def, 'p_source_value_id, p_classification_value_id,', '')))
         / length('p_source_value_id, p_classification_value_id,') <> 1 then
      raise exception '%: تعذّر العثور على قيم الرأس', function_body_note;
    end if;
    -- نوع المستند: فاتورة الأعمال «standard» (فاتورة ضريبية تُعتمد مسبقًا من
    -- ZATCA)، وغيرها «simplified» كما كان بالقيمة الافتراضية للعمود
    v_def := replace(v_def,
      'p_source_value_id, p_classification_value_id,',
      'p_source_value_id, p_classification_value_id, p_external_client_id, '
      || 'case when coalesce(p_is_b2b, false) and not coalesce(p_is_temporary, false) '
      || 'then ''standard'' else ''simplified'' end,');

    if (length(v_def) - length(replace(v_def, 'nullif(btrim(p_external_customer_name),''''),', '')))
         / length('nullif(btrim(p_external_customer_name),''''),') <> 1 then
      raise exception '%: تعذّر العثور على اسم العميل في الرأس', function_body_note;
    end if;
    v_def := replace(v_def,
      'nullif(btrim(p_external_customer_name),''''),',
      'coalesce(nullif(btrim(p_external_customer_name),''''), (select c.name from external_clients c where c.id = p_external_client_id and c.organization_id = p_organization_id)),');

    -- (د) شروط فاتورة الأعمال — قبل إدراج الرأس وبعد حساب إعفاء المريض
    v_pos := strpos(v_def, 'insert into sales_invoices (');
    if v_pos = 0 or strpos(v_def, 'v_patient_exempt') = 0
       or strpos(v_def, 'v_patient_exempt') > v_pos then
      raise exception '%: تعذّر العثور على موضع شروط فاتورة الأعمال', function_body_note;
    end if;
    v_block := $blk$-- (ج٢) فاتورة الأعمال (B2B) — مشتريها عميلٌ خارجيّ مكتمل الهويّة (0202)
  if p_external_client_id is not null and not exists (
       select 1 from external_clients c
        where c.id = p_external_client_id
          and c.organization_id = p_organization_id
          and not coalesce(c.is_disabled, false)) then
    raise exception 'العميل الخارجيّ المحدَّد غير موجود في هذه المنشأة أو معطَّل';
  end if;
  if p_external_client_id is not null and not coalesce(p_is_b2b, false) then
    raise exception 'العميل الخارجيّ يُحدَّد لفاتورة الأعمال (B2B) وحدها';
  end if;
  if coalesce(p_is_b2b, false) and not coalesce(p_is_temporary, false) then
    if p_external_client_id is null then
      raise exception 'فاتورة الأعمال (B2B) تُصدَر لعميلٍ خارجيّ (منشأة) — اختره في الفاتورة';
    end if;
    if coalesce(p_is_insurance, false) then
      raise exception 'فاتورة التأمين تُصدَر مبسّطة باسم المريض — لا فاتورة أعمال';
    end if;
    if v_patient_exempt then
      raise exception 'المريض معفًى من الضريبة كمواطن، وإعفاؤه يُبلَّغ في فاتورة مبسّطة باسمه — أزل «فاتورة أعمال» أو أصدرها بلا مريض';
    end if;
    if not exists (
         select 1 from external_clients c
          where c.id = p_external_client_id
            and (coalesce(c.vat_number, '') ~ '^3[0-9]{13}3$'
                 or coalesce(c.cr_number, '') ~ '^[0-9]{10}$')
            and coalesce(c.building_number, '') ~ '^[0-9]{4}$'
            and coalesce(c.postal_code, '') ~ '^[0-9]{5}$'
            and coalesce(btrim(c.street_name), '') <> ''
            and coalesce(btrim(c.district), '') <> ''
            and coalesce(btrim(c.city), '') <> '') then
      raise exception 'بيانات العميل الخارجيّ ناقصة لفاتورة الأعمال: الرقم الضريبيّ أو السجلّ التجاريّ، والعنوان الوطنيّ كاملًا (مبنى 4 أرقام، شارع، حيّ، مدينة، رمز بريديّ 5 أرقام) — أكملها في «العملاء الخارجيون»';
    end if;
  end if;

  $blk$;
    v_def := substr(v_def, 1, v_pos - 1) || v_block || substr(v_def, v_pos);

    execute v_def;
  end if;

  -- توقيع 0160 يُسقط: نسختان بالاسم نفسه تجعلان PostgREST يرفض النداء
  drop function if exists app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
    uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[],
    jsonb, uuid, uuid);
end $$;

revoke all on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[],
  jsonb, uuid, uuid, uuid) from public, anon;
grant execute on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[],
  jsonb, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ٥) الخصم على مستوى الفاتورة — والضريبة بعده
-- ---------------------------------------------------------------------------
/**
 * خصمٌ على المسوّدة كلّها (لا على بند).
 *
 * **ما كانت عليه (0091):** تكتب المبلغ في `discount_amount` فتمحو خصومات
 * البنود من الرأس، وتحسب الصافي = الإجمالي − الخصم + **الضريبة قبل الخصم** —
 * أي ضريبةً على مبلغٍ لم يُقبض. والمستند الضريبيّ بهذه الأرقام ترفضه ZATCA.
 *
 * **الآن:** الخصم يُحفظ وحده في `document_discount_amount`، ويوزَّع على أوعية
 * الضريبة (كلّ نسبة وعاء) بنسبة كلّ وعاء من المجموع، والباقي من التقريب على
 * أكبرها؛ وتُحسب ضريبة كلّ وعاء بعد خصمه. الدالّة الطرفية `zatca-invoice`
 * توزّعه بالقاعدة نفسها حرفيًّا وتطابق مجموعها بالرأس قبل الإرسال.
 *
 * الخصم صفرًا يُعيد الرأس إلى مجموع البنود كما هي. ولا خصم على مستوى فاتورة
 * التأمين: حصّتا المريض والشركة محسوبتان من البنود.
 */
create or replace function app_apply_invoice_discount(
  p_invoice_id uuid,
  p_amount     numeric,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv       sales_invoices%rowtype;
  v_amount    numeric(14,2);
  v_n         int;
  v_subtotal  numeric(14,2);
  v_line_disc numeric(14,2);
  v_total     numeric(14,2);
  v_vat       numeric(14,2);
  v_exempt    numeric(14,2);
  v_net       numeric(14,2);
begin
  select * into v_inv from sales_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if not app_has_permission(v_inv.organization_id, 'billing.discount') then
    raise exception 'صلاحيتك لا تسمح بمنح الخصم (billing.discount)';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'الخصم يُمنح على المسوّدة قبل الإصدار';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'الخصم يحتاج سببًا مكتوبًا';
  end if;
  if coalesce(v_inv.is_insurance_invoice, false) then
    raise exception 'الخصم على مستوى الفاتورة غير متاح لفاتورة التأمين — حصّتا المريض والشركة تُحسبان من البنود؛ اخصم على البند';
  end if;
  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount < 0 then
    raise exception 'قيمة الخصم غير مقبولة';
  end if;

  select count(*),
         coalesce(sum(round(coalesce(qty, 0) * coalesce(price, 0), 2)), 0),
         coalesce(sum(coalesce(discount_amount, 0)), 0),
         coalesce(sum(round(coalesce(qty, 0) * coalesce(price, 0), 2) - coalesce(discount_amount, 0)), 0)
    into v_n, v_subtotal, v_line_disc, v_total
    from sales_invoice_items
   where invoice_id = p_invoice_id;
  if v_n = 0 then
    raise exception 'لا بنود في الفاتورة';
  end if;
  if v_amount > v_total then
    raise exception 'الخصم (%) أكبر من صافي البنود قبل الضريبة (%)', v_amount, v_total;
  end if;

  if v_amount = 0 then
    -- بلا خصمٍ على المستند: الرأس مجموع البنود كما حُسبت
    select coalesce(sum(coalesce(vat_amount, 0)), 0),
           coalesce(sum(coalesce(exemption_amount, 0)), 0)
      into v_vat, v_exempt
      from sales_invoice_items
     where invoice_id = p_invoice_id;
  else
    with g as (
      select coalesce(vat_rate, 0) as rate,
             sum(round(coalesce(qty, 0) * coalesce(price, 0), 2) - coalesce(discount_amount, 0)) as base,
             sum(coalesce(exemption_amount, 0)) as exempt
        from sales_invoice_items
       where invoice_id = p_invoice_id
       group by coalesce(vat_rate, 0)
    ), r as (
      select g.*, row_number() over (order by g.base desc, g.rate desc) as rn
        from g
    ), s as (
      select r.*,
             case when r.rn > 1 then round(v_amount * r.base / v_total, 2) end as share
        from r
    ), a as (
      select s.rate, s.base, s.exempt,
             case when s.rn = 1
                  then v_amount - coalesce((select sum(s2.share) from s s2 where s2.rn > 1), 0)
                  else s.share end as alloc
        from s
    )
    select coalesce(sum(round((a.base - a.alloc) * a.rate / 100.0, 2)), 0),
           coalesce(sum(case when a.base > 0
                             then round(a.exempt * (a.base - a.alloc) / a.base, 2)
                             else 0 end), 0)
      into v_vat, v_exempt
      from a;
  end if;

  v_net := v_total - v_amount + v_vat;

  update sales_invoices set
    subtotal_amount          = v_subtotal,
    document_discount_amount = v_amount,
    discount_amount          = v_line_disc + v_amount,
    discount_reason          = btrim(p_reason),
    discount_by              = auth.uid(),
    vat_amount               = v_vat,
    exemption_amount         = v_exempt,
    net_amount               = v_net,
    patient_share_amount     = v_net,
    insurance_share_amount   = 0,
    updated_by               = auth.uid()
  where id = p_invoice_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_inv.organization_id, auth.uid(), 'billing', 'update', p_invoice_id,
          'فاتورة مبيعات', format('خصم على مستوى الفاتورة %s (الضريبة بعده %s)', v_amount, v_vat),
          btrim(p_reason));
end;
$$;

revoke all on function app_apply_invoice_discount(uuid, numeric, text) from public, anon;
grant execute on function app_apply_invoice_discount(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- ٦) الإشعار الدائن والمدين — صفة الأعمال، وخصم البند المرتجع
-- ---------------------------------------------------------------------------
/**
 * منسوخة من 0092، والتغيير:
 *   * الإشعار يرث `is_b2b` و`external_client_id` من فاتورته: إشعار فاتورة
 *     الأعمال مستندٌ معياريّ لمشتريها نفسه.
 *   * الإشعار الدائن يُرجع خصم البند بنسبة الكمية المرتجعة. كان يُرجع
 *     السعر كاملًا، فيُردّ للعميل أكثر ممّا دفع وتنقص ضريبةٌ لم تُحصَّل.
 *   * مبلغ الإعفاء وسبب الصفرية لدى ZATCA يُنقلان من البند الأصليّ.
 */
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
  v_disc  numeric;
  v_base  numeric;
  v_lvat  numeric;
  v_sub   numeric := 0;
  v_dsum  numeric := 0;
  v_vat   numeric := 0;
  v_exm   numeric := 0;
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
    external_customer_name, id_number, is_insurance_invoice, created_by,
    is_b2b, external_client_id)
  values (
    v_inv.organization_id, v_inv.branch_id, v_inv.clinic_id, v_inv.doctor_id,
    v_inv.patient_id, v_inv.visit_id,
    case when p_note_type = 'credit_note' then 'return' else 'sale' end,
    p_note_type, 'draft', p_invoice_id, p_note_type, btrim(p_reason),
    v_inv.external_customer_name, v_inv.id_number, v_inv.is_insurance_invoice, auth.uid(),
    coalesce(v_inv.is_b2b, false), v_inv.external_client_id)
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

    v_disc := case when p_note_type = 'credit_note' and coalesce(v_line.qty, 0) > 0
                   then round(coalesce(v_line.discount_amount, 0) * v_qty / v_line.qty, 2)
                   else 0 end;
    v_base := round(v_line.price * v_qty, 2) - v_disc;
    v_lvat := round(v_base * coalesce(v_line.vat_rate, 0) / 100, 2);

    insert into sales_invoice_items (
      invoice_id, item_id, doctor_id, description, line_type, price, qty,
      discount_amount, discount_reason,
      vat_rate, vat_amount, exemption_amount, net_amount, vat_category, exemption_reason,
      zatca_exemption_code,
      taxable_base, item_name_snapshot, unit_snapshot, source_type)
    values (
      v_note, v_line.item_id, v_line.doctor_id, v_line.description, v_line.line_type,
      v_line.price, v_qty,
      v_disc, case when v_disc > 0 then coalesce(v_line.discount_reason, 'خصم البند في الفاتورة الأصلية') end,
      v_line.vat_rate, v_lvat,
      case when coalesce(v_line.exemption_amount, 0) > 0 then v_base else 0 end,
      v_base + v_lvat,
      v_line.vat_category, v_line.exemption_reason,
      v_line.zatca_exemption_code,
      v_base, v_line.item_name_snapshot, v_line.unit_snapshot,
      'manual');

    v_sub  := v_sub + round(v_line.price * v_qty, 2);
    v_dsum := v_dsum + v_disc;
    v_vat  := v_vat + v_lvat;
    v_exm  := v_exm + case when coalesce(v_line.exemption_amount, 0) > 0 then v_base else 0 end;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'لا بنود في الإشعار';
  end if;

  update sales_invoices
     set subtotal_amount  = v_sub,
         discount_amount  = v_dsum,
         vat_amount       = v_vat,
         exemption_amount = v_exm,
         net_amount       = v_sub - v_dsum + v_vat,
         document_type    = p_note_type
   where id = v_note;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_inv.organization_id, auth.uid(), 'billing', 'add', v_note,
          case when p_note_type = 'credit_note' then 'إشعار دائن' else 'إشعار مدين' end,
          format('على الفاتورة %s بـ%s بندًا', v_inv.document_number, v_n), btrim(p_reason));

  return v_note;
end;
$$;

-- ---------------------------------------------------------------------------
-- ٧) لقطة المشتري عند الإصدار — منسوخة من 0196، والتغيير في كتلة المشتري
-- ---------------------------------------------------------------------------
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
  v_c    external_clients%rowtype;
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
  if new.external_client_id is not null then
    select * into v_c from external_clients where id = new.external_client_id;
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
  --
  -- فاتورة الأعمال (0202): المشتري العميل الخارجيّ بهويّته الضريبية وعنوانه
  -- الوطنيّ، والمريض — إن وُجد — متلقّي الخدمة يُحفظ معه للمرجع.
  new.buyer_snapshot := case
    when v_c.id is not null then jsonb_build_object(
      'kind',         'b2b',
      'name',         v_c.name,
      'vat_number',   nullif(btrim(v_c.vat_number), ''),
      'cr_number',    nullif(btrim(v_c.cr_number), ''),
      'phone',        coalesce(v_c.mobile_1, v_c.phone_1),
      'address', jsonb_build_object(
        'building_number',   v_c.building_number,
        'street_name',       v_c.street_name,
        'district',          v_c.district,
        'city',              v_c.city,
        'postal_code',       v_c.postal_code,
        'additional_number', v_c.additional_number,
        'country_code',      'SA'),
      'patient_name', v_p.name_ar,
      'file_number',  v_p.file_number)
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

  -- الفاتورة الضريبية (المعيارية) تشترط رقم المشتري الضريبيّ أو سجلّه؛ والمبسّطة
  -- لا تشترط. (قبل 0202 لم يكن شيءٌ يكتب `document_type = 'standard'`، فلم
  -- يُختبر هذا الشرط في الواقع.)
  if new.document_type = 'standard'
     and coalesce(new.buyer_snapshot->>'vat_number', '') = ''
     and coalesce(new.buyer_snapshot->>'cr_number', '') = ''
     and coalesce(new.buyer_snapshot->>'id_number', '') = '' then
    raise exception 'فاتورة الأعمال تحتاج الرقم الضريبيّ للعميل أو سجلّه التجاريّ — أكمله في «العملاء الخارجيون»';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- ٨) الورقة المطبوعة — بيانات مشتري الأعمال والخصم على مستوى الفاتورة
-- ---------------------------------------------------------------------------
-- منسوخ من 0157 كما هو، وتُضاف الأعمدة في آخره (`create or replace view`
-- يقبل الإضافة في الآخر ولا يمسّ الصلاحيات).
create or replace view v_invoice_print
with (security_invoker = on) as
select
  inv.id                                    as invoice_id,
  inv.organization_id,
  inv.branch_id,
  inv.invoice_number,
  inv.document_prefix,
  inv.document_number,
  inv.invoice_type,
  inv.document_type,
  inv.is_temporary,
  inv.status,
  coalesce(inv.issued_at, inv.created_at)   as invoice_at,

  -- ── البائع ───────────────────────────────────────────────────────────────
  coalesce(nullif(btrim(vs.legal_name_ar), ''), o.name)      as seller_name,
  vs.legal_name_en                                           as seller_name_en,
  coalesce(nullif(btrim(vs.vat_registration_number), ''),
           nullif(btrim(o.tax_number), ''))                  as seller_tax_number,
  vs.cr_number                                               as seller_cr_number,
  coalesce(
    nullif(btrim(ps.invoice_address_line), ''),
    nullif(btrim(concat_ws(' - ',
      nullif(btrim(vs.city), ''),
      nullif(btrim(vs.district), ''),
      nullif(btrim(vs.street_name), ''))), '')
  )                                                          as seller_address,

  -- ── الطباعة ──────────────────────────────────────────────────────────────
  ps.logo_url,
  coalesce(ps.show_logo, true)                               as show_logo,
  ps.footer_note,
  coalesce(ps.invoice_policy_lines, '{}')                    as policy_lines,
  coalesce(ps.invoice_paper_size, 'a4')                      as paper_size,

  -- ── العميل ───────────────────────────────────────────────────────────────
  inv.patient_id,
  coalesce(p.name_ar, inv.external_customer_name)            as customer_name,
  p.file_number                                              as customer_file_number,
  coalesce(p.id_number, inv.id_number)                       as customer_id_number,
  p.tax_number                                               as customer_tax_number,
  p.birth_date                                               as customer_birth_date,
  coalesce(nat.name_ar, inv_nat.name_ar)                     as customer_nationality,
  nat.name_en                                                as customer_nationality_en,
  coalesce(p.mobile_number, p.phone_1, inv.external_customer_mobile) as customer_mobile,
  p.email_1                                                  as customer_email,
  case when p.birth_date is not null
       then extract(year from age(current_date, p.birth_date))::int end  as age_years,
  case when p.birth_date is not null
       then extract(month from age(current_date, p.birth_date))::int end as age_months,
  case when p.birth_date is not null
       then extract(day from age(current_date, p.birth_date))::int end   as age_days,

  -- ── السياق السريريّ ──────────────────────────────────────────────────────
  d.name_ar                                                  as doctor_name,
  c.name                                                     as clinic_name,

  -- ── المبالغ ──────────────────────────────────────────────────────────────
  inv.subtotal_amount,
  inv.discount_amount,
  inv.vat_amount,
  inv.exemption_amount,
  inv.net_amount,
  inv.paid_amount,
  inv.remaining_amount,
  inv.is_insurance_invoice,
  inv.insurance_company_name,
  inv.insurance_share_amount,
  inv.patient_share_amount,
  inv.note,
  inv.zatca_qr,

  -- ── 0202: مشتري فاتورة الأعمال (من لقطة الإصدار، وإلّا من ملفّه) ─────────
  coalesce(inv.is_b2b, false)                                as is_b2b,
  case when inv.external_client_id is not null then
    coalesce(nullif(inv.buyer_snapshot->>'name', ''), ec.name) end            as buyer_name,
  case when inv.external_client_id is not null then
    coalesce(nullif(inv.buyer_snapshot->>'vat_number', ''), ec.vat_number) end as buyer_vat_number,
  case when inv.external_client_id is not null then
    coalesce(nullif(inv.buyer_snapshot->>'cr_number', ''), ec.cr_number) end  as buyer_cr_number,
  case when inv.external_client_id is not null then
    nullif(btrim(concat_ws(' - ',
      nullif(btrim(coalesce(inv.buyer_snapshot#>>'{address,building_number}', ec.building_number)), ''),
      nullif(btrim(coalesce(inv.buyer_snapshot#>>'{address,street_name}', ec.street_name)), ''),
      nullif(btrim(coalesce(inv.buyer_snapshot#>>'{address,district}', ec.district)), ''),
      nullif(btrim(coalesce(inv.buyer_snapshot#>>'{address,city}', ec.city)), ''),
      nullif(btrim(coalesce(inv.buyer_snapshot#>>'{address,postal_code}', ec.postal_code)), ''))), '')
  end                                                        as buyer_address,
  coalesce(inv.document_discount_amount, 0)                  as document_discount_amount
from sales_invoices inv
join organizations o          on o.id = inv.organization_id
left join organization_vat_settings vs on vs.organization_id = inv.organization_id
left join print_settings ps   on ps.organization_id = inv.organization_id
left join patients p          on p.id = inv.patient_id
left join lookup_values nat     on nat.id = p.nationality_value_id
left join lookup_values inv_nat on inv_nat.id = inv.nationality_value_id
left join doctors d           on d.id = inv.doctor_id
left join clinics c           on c.id = inv.clinic_id
left join external_clients ec on ec.id = inv.external_client_id;

commit;
