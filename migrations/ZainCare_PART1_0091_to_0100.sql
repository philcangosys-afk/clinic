-- ==========================================================================
-- ZainCare — الجزء 1 من 2 — الهجرات 0091 حتى 0100
-- ==========================================================================
-- كيف يُنفَّذ: انسخ هذا الملف كاملًا في محرّر SQL في Supabase واضغط Run
-- **مرة واحدة**. الملف يُنفَّذ داخل معاملة واحدة: إمّا أن ينجح كلّه أو
-- لا يتغيّر شيء في قاعدتك إطلاقًا. لا خطر من التنفيذ المكرَّر — كل شيء
-- فيه مكتوب ليُعاد بلا أثر (idempotent).
--
-- ترتيب التنفيذ: هذا الملف أولًا، ثم الجزء 2.
--
-- يشمل: الفوترة، الضريبة والفوترة الإلكترونية، مطالبات التأمين، التقارير،
--        الأمن والتدقيق، الباقات، المشتريات، المخزون المتقدّم، الأستاذ
--        العام، الموارد البشرية والرواتب.
--
-- **لا يوجد أيّ شيء يخصّ SMS في هذا الملف، ولا أيّ تكامل مزوّد رسائل.**
-- القناة الوحيدة المفعَّلة في التنبيهات هي `internal` داخل النظام.
-- ==========================================================================



-- ==========================================================================
-- [1/11]  0091_patient_document_consent_columns.sql
--          أعمدة الموافقات على مستندات المريض
-- ==========================================================================


alter table patient_documents
  add column if not exists expires_at date,
  add column if not exists is_consent boolean not null default false,
  add column if not exists signed_at timestamptz;

create index if not exists idx_patient_documents_expiry
  on patient_documents (organization_id, expires_at)
  where expires_at is not null;


-- ==========================================================================
-- [2/11]  0091_billing_and_payments.sql
--          الفوترة والمدفوعات
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0091 — الفوترة والمدفوعات
-- ---------------------------------------------------------------------------
-- المرحلة الحادية عشرة.
--
-- **حصر ما هو قائم أوّلًا** (كما نصّت الخطة)، فوُجد:
--   • `sales_invoices` و`sales_invoice_items` — أساس متين فيه الضريبة والتأمين
--     و`visit_id` و`visit_service_id`.
--   • `financial_vouchers` — سندات قبض وصرف، فيها `cash_register_id` و
--     `payment_method_value_id` و`related_sales_invoice_id`.
--   • `voucher_invoice_allocations` — توزيع سندٍ على عدّة فواتير (الدفع
--     المختلط ممكن أصلًا).
--   • `cash_registers` — صناديق لكل فرع.
--   • `lookup_categories.payment_methods` — طرق الدفع قائمة بحث.
--
-- فلا جدول بديل هنا. الجديد الوحيد `cash_register_shifts` — لا نظير له.
--
-- ما كان مكسورًا أو ناقصًا:
--
--   1) **لا حدّ للدفع.** `voucher_invoice_allocations` تقبل أيّ مبلغ: توزيع
--      ٥٠٠٠ على فاتورة قيمتها ٣٠٠ يمرّ، ويصير `paid_amount` أكبر من
--      `net_amount` و`remaining_amount` سالبًا.
--   2) **الفاتورة الملغاة تعود حيّة.** `app_recalc_invoice_paid_amount` تكتب
--      الحالة من المبلغ المدفوع بلا استثناء، فسندٌ قديم على فاتورة `void`
--      يعيدها `paid`.
--   3) **لا مصدر للبند.** `visit_service_id` وحده موجود؛ فحص المختبر والأشعة
--      والدواء المصروف والباقة لا يُعرف من أيّ منها جاء البند، ولا شيء يمنع
--      فوترة المصدر نفسه مرّتين.
--   4) **لا لقطة تاريخية.** تعديل اسم الخدمة في الكتالوج يغيّر ما تعرضه
--      الفواتير القديمة، لأن الاسم يُقرأ من `items` لا من البند.
--   5) **لا دورة حياة.** أربع حالات فقط، بلا `draft` ولا استرداد، وبلا قواعد
--      انتقال: القفز من غير مدفوعة إلى مدفوعة بتحديث مباشر مقبول.
--   6) **لا مناوبات صندوق.** `cash_registers` صناديق بلا فتح ولا إغلاق ولا
--      رصيد افتتاحي ولا جرد — فلا يُعرف من قبض ولا كم في الدرج.
--   7) **لا دوال دفع.** الواجهة تُدرج السند والتوزيع في طلبين منفصلين: فشل
--      الثاني يترك سندًا معلّقًا لا يخصم من فاتورة.
--
-- لا شيء هنا يخصّ الرسائل النصية.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) بند الفاتورة: مصدره ولقطته التاريخية
-- ===========================================================================

alter table sales_invoice_items
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists branch_id       uuid references branches(id),
  add column if not exists patient_id      uuid references patients(id),
  add column if not exists visit_id        uuid references patient_visits(id),
  add column if not exists source_type     text,
  add column if not exists source_id       uuid,
  add column if not exists item_name_snapshot text,
  add column if not exists unit_snapshot   text,
  add column if not exists vat_category    text not null default 'standard',
  add column if not exists exemption_reason text,
  add column if not exists taxable_base    numeric;

comment on column sales_invoice_items.source_type is
  'مصدر البند التشغيلي: visit_service خدمة زيارة، lab_order مختبر، radiology_order أشعة، dispensing صرف دواء، package باقة، manual بند يدوي.';
comment on column sales_invoice_items.item_name_snapshot is
  'اسم الخدمة **وقت البيع**. الفاتورة مستند تاريخيّ: تعديل الكتالوج غدًا لا يغيّر ما بيع أمس.';
comment on column sales_invoice_items.taxable_base is
  'الوعاء الضريبي = (السعر × الكمية) − الخصم. الضريبة تُحسب عليه لا على الإجمالي.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sii_source_type_check') then
    alter table sales_invoice_items add constraint sii_source_type_check check (
      source_type is null or source_type in
        ('visit_service','lab_order','radiology_order','dispensing','package','manual')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sii_vat_category_check') then
    alter table sales_invoice_items add constraint sii_vat_category_check check (
      vat_category in ('standard','zero_rated','exempt','out_of_scope')
    );
  end if;
  -- **الإعفاء بلا سبب مكتوب لا يصلح في مراجعة ضريبية.** البند المعفى أو
  -- الصفريّ يحمل سببه؛ والخاضع لا يحتاجه.
  if not exists (select 1 from pg_constraint where conname = 'sii_exemption_reason_check') then
    alter table sales_invoice_items add constraint sii_exemption_reason_check check (
      vat_category in ('standard','out_of_scope') or exemption_reason is not null
    ) not valid;
  end if;
end $$;

-- ترحيل البنود القائمة: `visit_service_id` كان المصدر الوحيد المعروف.
update sales_invoice_items li
   set source_type = 'visit_service', source_id = li.visit_service_id
 where li.visit_service_id is not null and li.source_type is null;

update sales_invoice_items li
   set source_type = coalesce(li.source_type, 'manual')
 where li.source_type is null;

update sales_invoice_items li
   set organization_id = coalesce(li.organization_id, inv.organization_id),
       branch_id       = coalesce(li.branch_id, inv.branch_id),
       patient_id      = coalesce(li.patient_id, inv.patient_id),
       visit_id        = coalesce(li.visit_id, inv.visit_id)
  from sales_invoices inv
 where inv.id = li.invoice_id
   and (li.organization_id is null or li.patient_id is null);

update sales_invoice_items li
   set item_name_snapshot = coalesce(li.item_name_snapshot, li.description, i.name_ar),
       unit_snapshot      = coalesce(li.unit_snapshot, i.unit)
  from items i
 where i.id = li.item_id and li.item_name_snapshot is null;

update sales_invoice_items
   set taxable_base = coalesce(taxable_base,
         greatest(coalesce(price,0) * coalesce(qty,1) - coalesce(discount_amount,0), 0))
 where taxable_base is null;

/**
 * البند يرث سياق فاتورته ويلتقط لقطته لحظة الإدراج.
 *
 * لولا هذا لبقيت الحقول فارغة في كل بند جديد، ولصار العمود حِلية لا بيانًا.
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

drop trigger if exists trg_fill_invoice_item_context on sales_invoice_items;
create trigger trg_fill_invoice_item_context
  before insert on sales_invoice_items
  for each row execute function app_fill_invoice_item_context();

-- **لا يُفوتَر المصدر مرّتين.** فحص مختبر واحد لا يصير بندين في فاتورتين.
-- الفواتير الملغاة مستثناة: إلغاء فاتورة يعيد الحقّ في فوترة مصدرها.
create unique index if not exists uq_invoice_source_once
  on sales_invoice_items (source_type, source_id)
  where source_id is not null and source_type <> 'manual';

create index if not exists idx_sii_visit on sales_invoice_items (visit_id)
  where visit_id is not null;

-- ===========================================================================
-- 2) دورة حياة الفاتورة
-- ===========================================================================
--
-- الحالات الأربع القائمة تبقى بأسمائها — تقرؤها شاشات كثيرة، وتغييرها يكسرها
-- بلا فائدة. يُضاف إليها ما ينقص:
--
--   draft               مسوّدة تُعدَّل
--   unpaid              صادرة ولم تُسدَّد    (= issued)
--   partial             مسدَّدة جزئيًا       (= partially_paid)
--   paid                مسدَّدة
--   partially_refunded  مستردّة جزئيًا
--   refunded            مستردّة كاملةً
--   void                ملغاة               (= cancelled)

do $$
begin
  alter table sales_invoices drop constraint if exists sales_invoices_status_check;
  alter table sales_invoices add constraint sales_invoices_status_check check (
    status in ('draft','unpaid','partial','paid','partially_refunded','refunded','void')
  );
end $$;

alter table sales_invoices
  add column if not exists issued_at        timestamptz,
  add column if not exists issued_by        uuid references auth.users(id),
  add column if not exists voided_at        timestamptz,
  add column if not exists voided_by        uuid references auth.users(id),
  add column if not exists void_reason      text,
  add column if not exists refunded_amount  numeric not null default 0,
  add column if not exists discount_reason  text,
  add column if not exists discount_by      uuid references auth.users(id),
  add column if not exists cash_shift_id    uuid,
  add column if not exists updated_by       uuid references auth.users(id);

-- الفواتير القائمة صادرة فعلًا: تُختم بوقت إنشائها لا بوقت الهجرة.
update sales_invoices set issued_at = created_at
 where issued_at is null and status <> 'draft';

create or replace function app_invoice_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'              then p_to in ('unpaid','void')
    -- الحالات المالية تُشتقّ من المبلغ لا من قرار بشريّ، فالرجوع فيها مشروع:
    -- إلغاء سندٍ يُنقص المحصَّل، فتعود «مدفوعة» إلى «جزئية» أو «غير مدفوعة».
    when 'unpaid'             then p_to in ('partial','paid','void')
    when 'partial'            then p_to in ('paid','unpaid','partially_refunded','refunded','void')
    when 'paid'               then p_to in ('partial','unpaid','partially_refunded','refunded')
    when 'partially_refunded' then p_to in ('refunded','paid','partial','unpaid','void')
    -- المستردّة كاملةً تُلغى: هذا **هو** مسار الإلغاء المشروع — يُردّ المال
    -- أوّلًا ثم يُلغى المستند. منعه يترك فواتير خاطئة حيّة إلى الأبد.
    when 'refunded'           then p_to in ('void')
    else false   -- void نهائية
  end;
$$;

comment on function app_invoice_status_allowed(text, text) is
  'انتقالات حالة الفاتورة. الرجوع من paid إلى partial مسموح لأن إلغاء سندٍ يُنقص المدفوع.';

-- ---------------------------------------------------------------------------
-- 2.1) الفاتورة الصادرة لا تُعدَّل
-- ---------------------------------------------------------------------------
/**
 * الفاتورة الصادرة لا تُعدَّل.
 *
 * والمعيار **`issued_at` لا الحالة**: `app_create_sales_invoice` (0043) تُدرج
 * الفاتورة بحالتها النهائية ثم تحسب مجاميعها في تحديثٍ تالٍ داخل المعاملة
 * نفسها. لو قِيس التجميد بالحالة لمُنعت الدالة من إكمال عملها هي — وهو ما
 * كشفه دليل رحلة المريض فورًا.
 *
 * فالتجميد يبدأ لحظة **الإصدار الفعليّ**، وهي اللحظة التي يُختم فيها
 * `issued_at`؛ وكل ما قبلها بناءٌ لم يكتمل.
 */
create or replace function app_guard_issued_invoice()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'draft' or old.issued_at is null then
    new.updated_at := now();
    return new;
  end if;

  if new.status is distinct from old.status
     and not app_invoice_status_allowed(old.status, new.status) then
    raise exception 'لا يمكن الانتقال بالفاتورة من «%» إلى «%»', old.status, new.status;
  end if;

  -- تصحيح فاتورة صادرة يكون بإلغاء قانوني أو إشعار دائن، لا بتعديل الأرقام.
  if new.subtotal_amount   is distinct from old.subtotal_amount
     or new.net_amount     is distinct from old.net_amount
     or new.vat_amount     is distinct from old.vat_amount
     or new.discount_amount is distinct from old.discount_amount
     or new.patient_id     is distinct from old.patient_id
     or new.invoice_type   is distinct from old.invoice_type then
    raise exception 'الفاتورة الصادرة لا تُعدَّل — ألغِها أو أصدر إشعارًا دائنًا';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_issued_invoice on sales_invoices;
create trigger trg_guard_issued_invoice
  before update on sales_invoices
  for each row execute function app_guard_issued_invoice();

-- وبنودها كذلك
create or replace function app_guard_issued_invoice_lines()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_issued timestamptz;
begin
  select status, issued_at into v_status, v_issued from sales_invoices
   where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' and v_issued is not null then
    raise exception 'بنود الفاتورة الصادرة لا تُعدَّل ولا تُحذف — ألغِ الفاتورة أو أصدر إشعارًا دائنًا';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_issued_invoice_lines on sales_invoice_items;
create trigger trg_guard_issued_invoice_lines
  before update or delete on sales_invoice_items
  for each row execute function app_guard_issued_invoice_lines();

-- ===========================================================================
-- 3) الصلاحيات
-- ===========================================================================

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('billing.view',      'عرض الفواتير',            'billing', 700),
  ('billing.issue',     'إصدار الفواتير',          'billing', 702),
  ('billing.discount',  'منح الخصومات',            'billing', 704),
  ('billing.refund',    'تنفيذ الاستردادات',       'billing', 706),
  ('billing.void',      'إلغاء الفواتير',          'billing', 708),
  ('billing.manual_line','إضافة بند يدوي',         'billing', 710),
  ('cashier.receive',   'استلام المدفوعات',        'cashier', 720),
  ('cashier.open',      'فتح مناوبة الصندوق',      'cashier', 722),
  ('cashier.close',     'إغلاق مناوبة الصندوق',    'cashier', 724),
  ('cashier.approve',   'اعتماد مناوبة بفرق',      'cashier', 726)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('receptionist',   'billing.view'), ('receptionist', 'billing.issue'),
  ('receptionist',   'cashier.receive'), ('receptionist', 'cashier.open'),
  ('receptionist',   'cashier.close'),
  ('accountant',     'billing.view'), ('accountant', 'billing.issue'),
  ('accountant',     'billing.discount'), ('accountant', 'billing.refund'),
  ('accountant',     'billing.void'), ('accountant', 'billing.manual_line'),
  ('accountant',     'cashier.receive'), ('accountant', 'cashier.open'),
  ('accountant',     'cashier.close'), ('accountant', 'cashier.approve'),
  ('doctor',         'billing.view'),
  ('nurse',          'billing.view'),
  ('branch_manager', 'billing.view'), ('branch_manager', 'billing.issue'),
  ('branch_manager', 'billing.discount'), ('branch_manager', 'billing.refund'),
  ('branch_manager', 'billing.void'), ('branch_manager', 'billing.manual_line'),
  ('branch_manager', 'cashier.receive'), ('branch_manager', 'cashier.open'),
  ('branch_manager', 'cashier.close'), ('branch_manager', 'cashier.approve')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 3.5) طرق الدفع: أكواد للقيم القائمة، لا قيم جديدة
-- ===========================================================================
--
-- الفئة `payment_methods` **ليست فارغة**: فيها عشر قيم بأسماء عربية
-- وإنجليزية (نقدي، ATM-MADA، Cheque Payment، بنك الراجحي…) — لكن **بلا
-- `code`**. والمحرّك يحتاج كودًا لا اسمًا: أن يعرف أن هذه الطريقة نقد يدخل
-- الدرج، وتلك تحويل لا يدخله.
--
-- الحلّ **ليس** إضافة «نقدًا» بجوار «نقدي» — ذلك تكرارٌ لغرضٍ واحد، وسندات
-- قديمة تشير إلى القيمة الأولى وجديدة إلى الثانية فينقسم التقرير. الحلّ أن
-- تُكسى القيم القائمة أكوادها.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('نقدي',                 'cash',            true),
      ('ATM-MADA',             'mada',            false),
      ('ATM-VISA/MasterCard',  'credit_card',     false),
      ('American Express',     'credit_card',     false),
      ('Cheque Payment',       'cheque',          false),
      ('خدمة تابي',            'bnpl',            false),
      ('رصيد عهدة خارجية',     'external_credit', false),
      ('بنك الراجحي',          'bank_transfer',   false),
      ('بنك الإنماء',          'bank_transfer',   false),
      ('بنك الجزيرة',          'bank_transfer',   false)
    ) as v(nm, cd, drawer)
  loop
    update lookup_values lv
       set code  = coalesce(lv.code, r.cd),
           extra = coalesce(lv.extra, '{}'::jsonb) || jsonb_build_object('affects_drawer', r.drawer)
      from lookup_categories c
     where c.id = lv.category_id
       and c.key = 'payment_methods'
       and lv.name_ar = r.nm;
  end loop;
end $$;

-- وما ينقص فعلًا يُضاف — ولا يُضاف ما له نظير.
insert into lookup_values (category_id, code, name_ar, name_en, sort_order, extra)
select c.id, v.code, v.ar, v.en, v.ord, v.ex
  from lookup_categories c
  cross join (values
    ('online',         'دفع إلكتروني', 'Online Payment',  90, '{"affects_drawer": false}'::jsonb),
    ('credit_account', 'حساب آجل',     'Credit Account', 100, '{"affects_drawer": false}'::jsonb),
    ('insurance',      'شركة التأمين', 'Insurance',      110, '{"affects_drawer": false}'::jsonb)
  ) as v(code, ar, en, ord, ex)
 where c.key = 'payment_methods' and c.organization_id is null
   and not exists (select 1 from lookup_values lv
                    where lv.category_id = c.id
                      and (lv.code = v.code or lv.name_ar = v.ar));

-- **النقد وحده يدخل الدرج**، و`extra.affects_drawer` تقولها صراحةً بدل أن
-- تُستنتج من الاسم — والاستنتاج من الأسماء هو ما يجعل مناوبةً تُغلق بعجزٍ
-- وهميّ لأن تحويلًا بنكيًا حُسب نقدًا.
--
-- فحص: طريقة نقد واحدة لا أكثر، وإلّا انقسم الدرج بين اثنتين.
do $$
declare v_n int;
begin
  select count(*) into v_n from lookup_values lv
    join lookup_categories c on c.id = lv.category_id
   where c.key = 'payment_methods' and lv.code = 'cash';
  if v_n <> 1 then
    raise exception 'يجب أن تكون طريقة دفع نقدية واحدة بالكود cash، ووُجد %', v_n;
  end if;
end $$;

-- ===========================================================================
-- 4) مناوبات الصندوق
-- ===========================================================================

alter table cash_registers
  add column if not exists code               text,
  add column if not exists requires_shift     boolean not null default true,
  add column if not exists allow_negative     boolean not null default false,
  add column if not exists created_by         uuid references auth.users(id),
  add column if not exists updated_at         timestamptz not null default now();

comment on column cash_registers.requires_shift is
  'حين يكون صحيحًا لا يُقبض نقدًا على هذا الصندوق إلّا داخل مناوبة مفتوحة.';

create table if not exists cash_register_shifts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  branch_id         uuid references branches(id),
  cash_register_id  uuid not null references cash_registers(id),
  shift_number      bigint,
  status            text not null default 'open'
                      check (status in ('open','closed','approved')),
  opened_at         timestamptz not null default now(),
  opened_by         uuid not null references auth.users(id),
  opening_balance   numeric not null default 0 check (opening_balance >= 0),
  closed_at         timestamptz,
  closed_by         uuid references auth.users(id),
  counted_balance   numeric,
  expected_balance  numeric,
  variance_amount   numeric,
  variance_reason   text,
  approved_at       timestamptz,
  approved_by       uuid references auth.users(id),
  note              text,
  created_at        timestamptz not null default now()
);

comment on table cash_register_shifts is
  'مناوبة صندوق: رصيد افتتاحي، ومقبوضات، ومصروفات، ورصيد متوقّع، ورصيد مجرود، وفرق بسببه.';

alter table cash_register_shifts enable row level security;

-- **مناوبة مفتوحة واحدة لكل صندوق.** مناوبتان مفتوحتان تعنيان أن المقبوضات
-- تتوزّع عشوائيًا بينهما ولا يُعرف من يضمن الدرج.
create unique index if not exists uq_one_open_shift_per_register
  on cash_register_shifts (cash_register_id) where status = 'open';

create index if not exists idx_shifts_lookup
  on cash_register_shifts (organization_id, cash_register_id, opened_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_registers_org_id_key') then
    alter table cash_registers add constraint cash_registers_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shifts_register_tenant_fk') then
    alter table cash_register_shifts add constraint shifts_register_tenant_fk
      foreign key (organization_id, cash_register_id)
      references cash_registers(organization_id, id) not valid;
  end if;
end $$;

alter table financial_vouchers
  add column if not exists cash_shift_id uuid references cash_register_shifts(id),
  add column if not exists is_void       boolean not null default false,
  add column if not exists voided_at     timestamptz,
  add column if not exists voided_by     uuid references auth.users(id),
  add column if not exists void_reason   text,
  add column if not exists refund_of_voucher_id uuid references financial_vouchers(id),
  add column if not exists branch_id     uuid references branches(id);

create index if not exists idx_vouchers_shift on financial_vouchers (cash_shift_id)
  where cash_shift_id is not null;

create or replace function app_open_cash_shift(
  p_cash_register_id uuid,
  p_opening_balance  numeric default 0,
  p_note             text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reg cash_registers%rowtype;
  v_id  uuid;
  v_n   bigint;
begin
  select * into v_reg from cash_registers where id = p_cash_register_id;
  if v_reg.id is null then raise exception 'الصندوق غير موجود'; end if;
  if v_reg.is_disabled then raise exception 'الصندوق معطَّل'; end if;
  if not app_has_permission(v_reg.organization_id, 'cashier.open') then
    raise exception 'صلاحيتك لا تسمح بفتح مناوبة (cashier.open)';
  end if;
  if coalesce(p_opening_balance, 0) < 0 then
    raise exception 'الرصيد الافتتاحي لا يكون سالبًا';
  end if;
  if exists (select 1 from cash_register_shifts
              where cash_register_id = p_cash_register_id and status = 'open') then
    raise exception 'للصندوق مناوبة مفتوحة بالفعل — أغلقها أوّلًا';
  end if;

  select coalesce(max(shift_number), 0) + 1 into v_n
    from cash_register_shifts where organization_id = v_reg.organization_id;

  insert into cash_register_shifts (
    organization_id, branch_id, cash_register_id, shift_number,
    opened_by, opening_balance, note)
  values (v_reg.organization_id, v_reg.branch_id, p_cash_register_id, v_n,
          auth.uid(), coalesce(p_opening_balance, 0), nullif(btrim(p_note), ''))
  returning id into v_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_reg.organization_id, auth.uid(), 'cashier', 'add', v_id,
          'مناوبة صندوق', format('فتح مناوبة %s برصيد افتتاحي %s', v_n, p_opening_balance));

  return v_id;
end;
$$;

/**
 * الرصيد المتوقّع في الدرج = الافتتاحي + المقبوض نقدًا − المصروف نقدًا.
 *
 * النقد وحده يُعدّ: تحويل بنكي أو مدى لا يدخل الدرج، وحسابه ضمنه يجعل كل
 * إغلاق يُظهر عجزًا وهميًا.
 */
create or replace function app_cash_shift_expected(p_shift_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.opening_balance
       + coalesce((
           select sum(case when v.voucher_type = 'receipt' then v.amount else -v.amount end)
             from financial_vouchers v
             join lookup_values lv on lv.id = v.payment_method_value_id
            where v.cash_shift_id = p_shift_id
              and not v.is_void
              -- `affects_drawer` لا `code = 'cash'`: قد تُضاف طرق نقدية أخرى
              -- (عهدة، صرافة) وتظلّ تدخل الدرج.
              and coalesce((lv.extra->>'affects_drawer')::boolean, false)
         ), 0)
    from cash_register_shifts s
   where s.id = p_shift_id;
$$;

create or replace function app_close_cash_shift(
  p_shift_id        uuid,
  p_counted_balance numeric,
  p_variance_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s        cash_register_shifts%rowtype;
  v_expected numeric;
  v_variance numeric;
begin
  select * into v_s from cash_register_shifts where id = p_shift_id for update;
  if v_s.id is null then raise exception 'المناوبة غير موجودة'; end if;
  if not app_has_permission(v_s.organization_id, 'cashier.close') then
    raise exception 'صلاحيتك لا تسمح بإغلاق المناوبة (cashier.close)';
  end if;
  if v_s.status <> 'open' then
    raise exception 'المناوبة % — أُغلقت بالفعل', v_s.status;
  end if;
  if p_counted_balance is null then
    raise exception 'الرصيد الفعليّ المجرود مطلوب — الإغلاق بلا جرد ليس إغلاقًا';
  end if;

  v_expected := app_cash_shift_expected(p_shift_id);
  v_variance := round(p_counted_balance - v_expected, 2);

  -- فرقٌ بلا سبب مكتوب هو المكان الذي يختفي فيه المال.
  if v_variance <> 0 and coalesce(btrim(p_variance_reason), '') = '' then
    raise exception 'فرق قدره % يحتاج سببًا مكتوبًا', v_variance;
  end if;

  update cash_register_shifts set
    status           = 'closed',
    closed_at        = now(),
    closed_by        = auth.uid(),
    counted_balance  = p_counted_balance,
    expected_balance = v_expected,
    variance_amount  = v_variance,
    variance_reason  = nullif(btrim(p_variance_reason), '')
  where id = p_shift_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_s.organization_id, auth.uid(), 'cashier', 'update', p_shift_id,
          'مناوبة صندوق',
          format('إغلاق: متوقّع %s، مجرود %s، فرق %s', v_expected, p_counted_balance, v_variance),
          nullif(btrim(p_variance_reason), ''));

  return jsonb_build_object('expected', v_expected, 'counted', p_counted_balance,
                            'variance', v_variance);
end;
$$;

create or replace function app_approve_cash_shift(p_shift_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s cash_register_shifts%rowtype;
begin
  select * into v_s from cash_register_shifts where id = p_shift_id for update;
  if v_s.id is null then raise exception 'المناوبة غير موجودة'; end if;
  if not app_has_permission(v_s.organization_id, 'cashier.approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد المناوبة (cashier.approve)';
  end if;
  if v_s.status <> 'closed' then
    raise exception 'تُعتمد المناوبة المغلقة فقط';
  end if;
  -- من أغلق لا يعتمد: الفصل بين التنفيذ والمراجعة هو كل معنى الاعتماد.
  if v_s.closed_by = auth.uid() then
    raise exception 'من أغلق المناوبة لا يعتمدها — الاعتماد مراجعة لا تكرار';
  end if;

  update cash_register_shifts
     set status = 'approved', approved_at = now(), approved_by = auth.uid(),
         note = concat_ws(' | ', note, nullif(btrim(p_note), ''))
   where id = p_shift_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_s.organization_id, auth.uid(), 'cashier', 'update', p_shift_id,
          'مناوبة صندوق', format('اعتماد مناوبة بفرق %s', coalesce(v_s.variance_amount, 0)));
end;
$$;

-- المناوبة المغلقة لا تُعدَّل
create or replace function app_guard_closed_shift()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('closed','approved')
     and new.status = old.status
     and (new.opening_balance is distinct from old.opening_balance
       or new.counted_balance is distinct from old.counted_balance
       or new.cash_register_id is distinct from old.cash_register_id) then
    raise exception 'المناوبة المغلقة لا تُعدَّل';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_closed_shift on cash_register_shifts;
create trigger trg_guard_closed_shift
  before update on cash_register_shifts
  for each row execute function app_guard_closed_shift();

-- ===========================================================================
-- 5) الفاتورة من الزيارة — عملية ذرّية واحدة
-- ===========================================================================

/**
 * يجمع كل ما نُفِّذ في الزيارة ولم يُفوتَر، ويسعّره بالسعر الصحيح، ويوزّع
 * حصّتَي المريض والتأمين، ويصدر الفاتورة وبنودها، ويعلّم المصادر مفوترة —
 * كلّه في معاملة واحدة.
 *
 * قبلها كانت الواجهة تجمع البنود بنفسها وترسلها: فما نسيته الواجهة لا يُفوتَر،
 * وما كرّرته يُفوتَر مرّتين.
 */
create or replace function app_create_invoice_from_visit(
  p_visit_id     uuid,
  p_use_insurance boolean default true,
  p_membership_id uuid default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit    patient_visits%rowtype;
  v_invoice  uuid;
  v_member   patient_insurance_memberships%rowtype;
  v_company  uuid;
  v_src      record;
  v_price    record;
  v_cov      jsonb;
  v_lines    int := 0;
  v_sub      numeric := 0;
  v_vat      numeric := 0;
  v_pat      numeric := 0;
  v_ins      numeric := 0;
  v_amount   numeric;
  v_vat_rate numeric;
  v_vat_amt  numeric;
  v_cat      text;
begin
  select * into v_visit from patient_visits where id = p_visit_id for update;
  if v_visit.id is null then raise exception 'الزيارة غير موجودة'; end if;
  if not app_has_permission(v_visit.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بإصدار الفواتير (billing.issue)';
  end if;
  if not app_can_access_branch(v_visit.organization_id, v_visit.branch_id) then
    raise exception 'الزيارة تتبع فرعًا لا تملك الوصول إليه';
  end if;

  -- العضوية التأمينية
  if p_use_insurance then
    if p_membership_id is not null then
      select * into v_member from patient_insurance_memberships
       where id = p_membership_id and patient_id = v_visit.patient_id;
      if v_member.id is null then
        raise exception 'العضوية التأمينية لا تخصّ هذا المريض';
      end if;
    else
      select * into v_member from patient_insurance_memberships
       where patient_id = v_visit.patient_id and is_active
         and (expiry_date is null or expiry_date >= current_date)
       order by created_at desc limit 1;
    end if;
    if v_member.id is not null then
      select company_id into v_company from insurance_policies where id = v_member.policy_id;
    end if;
  end if;

  insert into sales_invoices (
    organization_id, branch_id, clinic_id, doctor_id, patient_id,
    appointment_id, visit_id, invoice_type, status,
    is_insurance_invoice, note, created_by)
  values (v_visit.organization_id, v_visit.branch_id, v_visit.clinic_id, v_visit.doctor_id,
          v_visit.patient_id, v_visit.appointment_id, p_visit_id, 'sale', 'draft',
          v_member.id is not null, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_invoice;

  -- ── الخدمات المنفَّذة غير المفوترة
  for v_src in
    -- `patient_visit_services` بلا `doctor_id`: الطبيب المنفِّذ في
    -- `performed_by`، وإلّا فطبيب الزيارة.
    select s.id, s.item_id, s.qty, s.unit_price,
           coalesce(s.performed_by, v_visit.doctor_id) as doctor_id,
           i.name_ar, i.unit, i.is_vat_exempt, i.vat_rate_override
      from patient_visit_services s
      join items i on i.id = s.item_id
     where s.visit_id = p_visit_id
       and s.status in ('ordered','performed')
       and not exists (select 1 from sales_invoice_items li
                        where li.source_type = 'visit_service' and li.source_id = s.id)
  loop
    select price, discount_percent, source_kind, source_list_id, contract_id
      into v_price
      from app_resolve_item_price_v2(v_visit.organization_id, v_src.item_id,
                                     v_visit.branch_id, v_company, null, current_date);

    v_amount := coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) * coalesce(v_src.qty, 1);

    -- التغطية
    v_pat := 0; v_ins := 0;
    if v_member.id is not null then
      v_cov := app_insurance_coverage(v_member.id, v_src.item_id, v_amount);
      v_ins := coalesce((v_cov->>'insurer_share')::numeric, 0);
      v_pat := coalesce((v_cov->>'patient_share')::numeric, v_amount);
    else
      v_pat := v_amount;
    end if;

    -- الضريبة على مستوى البند
    v_cat      := case when v_src.is_vat_exempt then 'exempt' else 'standard' end;
    v_vat_rate := case when v_cat = 'exempt' then 0
                       else coalesce(v_src.vat_rate_override,
                                     (select default_vat_rate from organizations
                                       where id = v_visit.organization_id), 15) end;
    v_vat_amt  := round(v_amount * v_vat_rate / 100, 2);

    insert into sales_invoice_items (
      invoice_id, item_id, doctor_id, description, line_type,
      price, qty, vat_rate, vat_amount, net_amount,
      visit_service_id, source_type, source_id,
      price_source_kind, price_source_list_id, contract_id, list_price,
      patient_share, insurer_share, covered_amount,
      vat_category, exemption_reason, taxable_base, item_name_snapshot, unit_snapshot)
    values (
      v_invoice, v_src.item_id, v_src.doctor_id, v_src.name_ar, 'normal',
      coalesce(nullif(v_src.unit_price, 0), v_price.price, 0), coalesce(v_src.qty, 1),
      v_vat_rate, v_vat_amt, v_amount + v_vat_amt,
      v_src.id, 'visit_service', v_src.id,
      v_price.source_kind, v_price.source_list_id, v_price.contract_id, v_price.price,
      v_pat, v_ins, v_ins,
      v_cat,
      case when v_cat = 'standard' then null
           else 'صنف معلَّم معفى في الكتالوج' end,
      v_amount, v_src.name_ar, v_src.unit);

    update patient_visit_services set status = 'invoiced', status_changed_at = now(),
           status_changed_by = auth.uid()
     where id = v_src.id;

    v_sub := v_sub + v_amount;
    v_vat := v_vat + v_vat_amt;
    v_lines := v_lines + 1;
  end loop;

  -- ── الأدوية المصروفة غير المفوترة
  for v_src in
    select di.id, di.drug_item_id as item_id, di.quantity_dispensed as qty,
           di.unit_price, i.name_ar, i.unit, i.is_vat_exempt, i.vat_rate_override
      from dispensing_items di
      join dispensing_records dr on dr.id = di.dispensing_record_id
      join items i on i.id = di.drug_item_id
     where dr.prescription_id in (select id from prescriptions where visit_id = p_visit_id)
       and dr.status <> 'cancelled'
       and not exists (select 1 from sales_invoice_items li
                        where li.source_type = 'dispensing' and li.source_id = di.id)
  loop
    v_amount   := coalesce(v_src.unit_price, 0) * coalesce(v_src.qty, 1);
    v_cat      := case when v_src.is_vat_exempt then 'exempt' else 'standard' end;
    v_vat_rate := case when v_cat = 'exempt' then 0
                       else coalesce(v_src.vat_rate_override,
                                     (select default_vat_rate from organizations
                                       where id = v_visit.organization_id), 15) end;
    v_vat_amt  := round(v_amount * v_vat_rate / 100, 2);

    v_pat := v_amount; v_ins := 0;
    if v_member.id is not null then
      v_cov := app_insurance_coverage(v_member.id, v_src.item_id, v_amount);
      v_ins := coalesce((v_cov->>'insurer_share')::numeric, 0);
      v_pat := coalesce((v_cov->>'patient_share')::numeric, v_amount);
    end if;

    insert into sales_invoice_items (
      invoice_id, item_id, description, line_type, price, qty,
      vat_rate, vat_amount, net_amount, source_type, source_id,
      patient_share, insurer_share, vat_category, exemption_reason, taxable_base,
      item_name_snapshot, unit_snapshot)
    values (v_invoice, v_src.item_id, v_src.name_ar, 'normal',
            coalesce(v_src.unit_price, 0), coalesce(v_src.qty, 1),
            v_vat_rate, v_vat_amt, v_amount + v_vat_amt, 'dispensing', v_src.id,
            v_pat, v_ins, v_cat,
            case when v_cat = 'standard' then null
                 else 'صنف معلَّم معفى في الكتالوج' end,
            v_amount, v_src.name_ar, v_src.unit);

    v_sub := v_sub + v_amount;
    v_vat := v_vat + v_vat_amt;
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'لا توجد خدمات منفَّذة غير مفوترة في هذه الزيارة';
  end if;

  update sales_invoices set
    subtotal_amount = v_sub,
    vat_amount      = v_vat,
    net_amount      = v_sub + v_vat,
    -- `remaining_amount` عمود محسوب (net − paid) ولا يُكتب فيه.
    patient_share_amount   = (select coalesce(sum(patient_share), 0)
                                from sales_invoice_items where invoice_id = v_invoice),
    insurance_share_amount = (select coalesce(sum(insurer_share), 0)
                                from sales_invoice_items where invoice_id = v_invoice),
    insurance_membership_number = v_member.membership_number,
    updated_at = now()
  where id = v_invoice;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_visit.organization_id, auth.uid(), 'billing', 'add', v_invoice,
          'فاتورة مبيعات',
          format('أُنشئت من زيارة بـ%s بندًا، الإجمالي %s', v_lines, v_sub + v_vat));

  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5.1) إصدار الفاتورة وإلغاؤها
-- ---------------------------------------------------------------------------
create or replace function app_set_invoice_status(
  p_invoice_id uuid,
  p_status     text,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv sales_invoices%rowtype;
  v_perm text;
begin
  select * into v_inv from sales_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if v_inv.status = p_status then return; end if;
  if not app_invoice_status_allowed(v_inv.status, p_status) then
    raise exception 'لا يمكن الانتقال بالفاتورة من «%» إلى «%»', v_inv.status, p_status;
  end if;

  v_perm := case when p_status = 'void' then 'billing.void' else 'billing.issue' end;
  if not app_has_permission(v_inv.organization_id, v_perm) then
    raise exception 'صلاحيتك لا تسمح بهذا الإجراء (%)', v_perm;
  end if;

  if p_status = 'void' then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'إلغاء الفاتورة يحتاج سببًا مكتوبًا';
    end if;
    -- لا إلغاء لفاتورة عليها تحصيل لم يُستردّ: المال قُبض فعلًا.
    if coalesce(v_inv.paid_amount, 0) - coalesce(v_inv.refunded_amount, 0) > 0 then
      raise exception 'على الفاتورة مبلغ محصَّل % — استردّه أوّلًا',
        v_inv.paid_amount - coalesce(v_inv.refunded_amount, 0);
    end if;
  end if;

  if p_status = 'unpaid' and v_inv.status = 'draft' then
    if not exists (select 1 from sales_invoice_items where invoice_id = p_invoice_id) then
      raise exception 'لا تُصدَر فاتورة بلا بنود';
    end if;
  end if;

  update sales_invoices set
    status     = p_status,
    issued_at  = case when p_status = 'unpaid' and issued_at is null then now() else issued_at end,
    issued_by  = case when p_status = 'unpaid' and issued_by is null then auth.uid() else issued_by end,
    voided_at  = case when p_status = 'void' then now() else voided_at end,
    voided_by  = case when p_status = 'void' then auth.uid() else voided_by end,
    void_reason = case when p_status = 'void' then btrim(p_reason) else void_reason end,
    updated_by = auth.uid()
  where id = p_invoice_id;

  -- إلغاء الفاتورة يُرجع خدماتها إلى «منفَّذة» فتُفوتَر من جديد.
  if p_status = 'void' then
    update patient_visit_services s
       set status = 'performed', status_changed_at = now(), status_changed_by = auth.uid()
      from sales_invoice_items li
     where li.invoice_id = p_invoice_id
       and li.source_type = 'visit_service' and li.source_id = s.id
       and s.status = 'invoiced';
    delete from sales_invoice_items where invoice_id = p_invoice_id and false;  -- لا حذف
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_inv.organization_id, auth.uid(), 'billing', 'update', p_invoice_id,
          'فاتورة مبيعات', format('%s ← %s', v_inv.status, p_status),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5.2) الدالة القديمة تختم الإصدار
-- ---------------------------------------------------------------------------
--
-- `app_create_sales_invoice` (0043) تُنشئ فاتورة صادرة ولا تختم `issued_at`،
-- فتبقى — بمعيار الحارس أعلاه — قابلة للتعديل إلى الأبد. تُرقَّع بالنصّ لا
-- بإعادة كتابة مئتي سطر: يُضاف ختم الإصدار إلى تحديث المجاميع نفسه، وهو آخر
-- ما تفعله بالفاتورة.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_sales_invoice';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_def := replace(v_def, chr(13), '');

  if v_def like '%status                 = v_status%'
     and v_def not like '%issued_at              = coalesce(issued_at, now())%' then
    v_def := replace(v_def,
      'status                 = v_status',
      'status                 = v_status,' || chr(10) ||
      '         issued_at              = coalesce(issued_at, now()),' || chr(10) ||
      '         issued_by              = coalesce(issued_by, auth.uid())');
    execute v_def;
  elsif v_def not like '%issued_at%' then
    raise exception 'تعذّر ترقيع app_create_sales_invoice: شكلها تغيّر — راجع 0043';
  end if;
end $$;

-- ===========================================================================
-- 6) المدفوعات
-- ===========================================================================

-- **لا دفعة تتجاوز المستحق.** الحارس في المحرّك لا في الواجهة.
create or replace function app_guard_allocation_amount()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_net   numeric;
  v_other numeric;
  v_type  text;
begin
  select i.net_amount into v_net from sales_invoices i where i.id = new.sales_invoice_id;
  if v_net is null then raise exception 'الفاتورة غير موجودة'; end if;

  select v.voucher_type into v_type from financial_vouchers v where v.id = new.voucher_id;

  if new.amount <= 0 then
    raise exception 'مبلغ التوزيع يجب أن يكون أكبر من صفر';
  end if;

  if v_type = 'receipt' then
    select coalesce(sum(a.amount), 0) into v_other
      from voucher_invoice_allocations a
      join financial_vouchers v on v.id = a.voucher_id
     where a.sales_invoice_id = new.sales_invoice_id
       and v.voucher_type = 'receipt' and not v.is_void
       and a.id is distinct from new.id;

    if v_other + new.amount > v_net + 0.001 then
      raise exception 'المبلغ يتجاوز المستحق: المطلوب %، المسدَّد %، والمتبقّي %',
        new.amount, v_other, round(v_net - v_other, 2);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_allocation_amount on voucher_invoice_allocations;
create trigger trg_guard_allocation_amount
  before insert or update on voucher_invoice_allocations
  for each row execute function app_guard_allocation_amount();

-- ---------------------------------------------------------------------------
-- 6.1) حساب المدفوع والحالة — مع احترام الإلغاء والاسترداد
-- ---------------------------------------------------------------------------
create or replace function app_recalc_invoice_paid_amount(target_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paid     numeric;
  v_refunded numeric;
  v_net      numeric;
  v_status   text;
  v_new      text;
begin
  if target_invoice is null then return; end if;

  select coalesce(sum(a.amount), 0) into v_paid
    from voucher_invoice_allocations a
    join financial_vouchers v on v.id = a.voucher_id
   where a.sales_invoice_id = target_invoice
     and v.voucher_type = 'receipt' and not v.is_void;

  select coalesce(sum(a.amount), 0) into v_refunded
    from voucher_invoice_allocations a
    join financial_vouchers v on v.id = a.voucher_id
   where a.sales_invoice_id = target_invoice
     and v.voucher_type = 'expense' and not v.is_void
     and v.refund_of_voucher_id is not null;

  select net_amount, status into v_net, v_status
    from sales_invoices where id = target_invoice;

  -- **الملغاة والمسوّدة لا تُحسَب حالتهما من المال.** الدالة القديمة كانت
  -- تكتب الحالة بلا استثناء، فسندٌ على فاتورة ملغاة يعيدها «مدفوعة».
  if v_status in ('void','draft') then
    update sales_invoices
       set paid_amount = v_paid, refunded_amount = v_refunded
     where id = target_invoice;
    return;
  end if;

  v_new := case
    when v_refunded >= v_paid and v_refunded > 0 then 'refunded'
    when v_refunded > 0                          then 'partially_refunded'
    when v_paid <= 0                             then 'unpaid'
    when v_paid >= coalesce(v_net, 0) - 0.001    then 'paid'
    else 'partial'
  end;

  -- `remaining_amount` محسوب من (net − paid) في تعريف الجدول، فلا يُكتب.
  -- المدفوع هنا **صافي** المحصَّل: المقبوض ناقص المستردّ، وإلّا بقي المتبقّي
  -- صفرًا بعد استرداد كامل.
  update sales_invoices
     set paid_amount      = v_paid - v_refunded,
         refunded_amount  = v_refunded,
         status           = v_new
   where id = target_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6.2) استلام دفعة — سند وتوزيع في عملية واحدة
-- ---------------------------------------------------------------------------
create or replace function app_receive_invoice_payment(
  p_invoice_id       uuid,
  p_amount           numeric,
  p_payment_method_value_id uuid,
  p_cash_register_id uuid default null,
  p_reference        text default null,
  p_note             text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv     sales_invoices%rowtype;
  v_method  text;
  v_shift   uuid;
  v_voucher uuid;
  v_due     numeric;
  v_n       bigint;
begin
  select * into v_inv from sales_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if not app_has_permission(v_inv.organization_id, 'cashier.receive') then
    raise exception 'صلاحيتك لا تسمح باستلام المدفوعات (cashier.receive)';
  end if;
  if v_inv.status = 'draft' then
    raise exception 'الفاتورة مسوّدة — أصدرها قبل التحصيل';
  end if;
  if v_inv.status in ('void','refunded') then
    raise exception 'الفاتورة % — لا تحصيل عليها', v_inv.status;
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'مبلغ الدفعة يجب أن يكون أكبر من صفر';
  end if;

  v_due := coalesce(v_inv.net_amount, 0) - coalesce(v_inv.paid_amount, 0);
  if p_amount > v_due + 0.001 then
    raise exception 'المبلغ % يتجاوز المتبقّي %', p_amount, round(v_due, 2);
  end if;

  select code into v_method from lookup_values where id = p_payment_method_value_id;
  if v_method is null then raise exception 'طريقة الدفع غير معروفة'; end if;

  -- ── النقد يحتاج مناوبة مفتوحة إن كان الصندوق يشترطها
  if v_method = 'cash' then
    if p_cash_register_id is null then
      raise exception 'الدفع النقدي يحتاج تحديد الصندوق';
    end if;
    if not exists (select 1 from cash_registers
                    where id = p_cash_register_id
                      and organization_id = v_inv.organization_id and not is_disabled) then
      raise exception 'الصندوق غير صالح أو معطَّل';
    end if;
    select s.id into v_shift from cash_register_shifts s
     where s.cash_register_id = p_cash_register_id and s.status = 'open';
    if v_shift is null
       and (select requires_shift from cash_registers where id = p_cash_register_id) then
      raise exception 'لا مناوبة مفتوحة على هذا الصندوق — افتح مناوبة قبل القبض النقدي';
    end if;
  end if;

  select coalesce(max(voucher_number), 0) + 1 into v_n
    from financial_vouchers where organization_id = v_inv.organization_id;

  insert into financial_vouchers (
    organization_id, branch_id, voucher_number, voucher_type, voucher_date, amount,
    payment_method_value_id, cash_register_id, cash_shift_id, bank_transfer_ref,
    related_sales_invoice_id, patient_id, clinic_id, doctor_id, description, created_by)
  values (
    v_inv.organization_id, v_inv.branch_id, v_n, 'receipt', current_date, p_amount,
    p_payment_method_value_id, p_cash_register_id, v_shift, nullif(btrim(p_reference), ''),
    p_invoice_id, v_inv.patient_id, v_inv.clinic_id, v_inv.doctor_id,
    coalesce(nullif(btrim(p_note), ''), 'تحصيل فاتورة'), auth.uid())
  returning id into v_voucher;

  insert into voucher_invoice_allocations (voucher_id, sales_invoice_id, amount)
  values (v_voucher, p_invoice_id, p_amount);

  perform app_recalc_invoice_paid_amount(p_invoice_id);

  -- خدمات الفاتورة المسدَّدة تنتقل إلى «مدفوعة»
  if (select status from sales_invoices where id = p_invoice_id) = 'paid' then
    update patient_visit_services s
       set status = 'paid', status_changed_at = now(), status_changed_by = auth.uid()
      from sales_invoice_items li
     where li.invoice_id = p_invoice_id
       and li.source_type = 'visit_service' and li.source_id = s.id
       and s.status = 'invoiced';
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_inv.organization_id, auth.uid(), 'billing', 'add', v_voucher,
          'سند قبض', format('تحصيل %s على الفاتورة %s بطريقة %s',
                            p_amount, coalesce(v_inv.invoice_number::text, ''), v_method));

  return v_voucher;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6.3) الاسترداد
-- ---------------------------------------------------------------------------
create or replace function app_refund_invoice_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_reason     text,
  p_cash_register_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv       sales_invoices%rowtype;
  v_refunded  numeric;
  v_available numeric;
  v_voucher   uuid;
  v_src       uuid;
  v_shift     uuid;
  v_n         bigint;
  v_method    uuid;
begin
  select * into v_inv from sales_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if not app_has_permission(v_inv.organization_id, 'billing.refund') then
    raise exception 'صلاحيتك لا تسمح بالاسترداد (billing.refund)';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'الاسترداد يحتاج سببًا مكتوبًا';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'مبلغ الاسترداد يجب أن يكون أكبر من صفر';
  end if;

  -- **لا استرداد بأكثر من المحصَّل.** أوضح قاعدة في الباب وأكثرها إهمالًا.
  select coalesce(sum(a.amount), 0) into v_refunded
    from voucher_invoice_allocations a
    join financial_vouchers v on v.id = a.voucher_id
   where a.sales_invoice_id = p_invoice_id
     and v.voucher_type = 'expense' and not v.is_void
     and v.refund_of_voucher_id is not null;

  v_available := coalesce(v_inv.paid_amount, 0) - v_refunded;
  if p_amount > v_available + 0.001 then
    raise exception 'المبلغ % يتجاوز القابل للاسترداد % (محصَّل % ومستردّ %)',
      p_amount, round(v_available, 2), v_inv.paid_amount, v_refunded;
  end if;

  -- السند الأصلي: الاسترداد يعود إلى ما قُبض، ويرث طريقته
  select v.id, v.payment_method_value_id into v_src, v_method
    from voucher_invoice_allocations a
    join financial_vouchers v on v.id = a.voucher_id
   where a.sales_invoice_id = p_invoice_id
     and v.voucher_type = 'receipt' and not v.is_void
   order by v.created_at limit 1;

  if v_src is null then raise exception 'لا سند قبض على هذه الفاتورة'; end if;

  if p_cash_register_id is not null then
    select s.id into v_shift from cash_register_shifts s
     where s.cash_register_id = p_cash_register_id and s.status = 'open';
  end if;

  select coalesce(max(voucher_number), 0) + 1 into v_n
    from financial_vouchers where organization_id = v_inv.organization_id;

  insert into financial_vouchers (
    organization_id, branch_id, voucher_number, voucher_type, voucher_date, amount,
    payment_method_value_id, cash_register_id, cash_shift_id,
    related_sales_invoice_id, patient_id, refund_of_voucher_id, description, created_by)
  values (
    v_inv.organization_id, v_inv.branch_id, v_n, 'expense', current_date, p_amount,
    v_method, p_cash_register_id, v_shift,
    p_invoice_id, v_inv.patient_id, v_src, 'استرداد: ' || btrim(p_reason), auth.uid())
  returning id into v_voucher;

  insert into voucher_invoice_allocations (voucher_id, sales_invoice_id, amount)
  values (v_voucher, p_invoice_id, p_amount);

  perform app_recalc_invoice_paid_amount(p_invoice_id);

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_inv.organization_id, auth.uid(), 'billing', 'add', v_voucher,
          'سند استرداد', format('استرداد %s من الفاتورة', p_amount), btrim(p_reason));

  return v_voucher;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6.4) إلغاء سند — تعطيل لا حذف
-- ---------------------------------------------------------------------------
create or replace function app_void_financial_voucher(
  p_voucher_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_v   financial_vouchers%rowtype;
  v_inv uuid;
begin
  select * into v_v from financial_vouchers where id = p_voucher_id for update;
  if v_v.id is null then raise exception 'السند غير موجود'; end if;
  if not app_has_permission(v_v.organization_id, 'billing.void') then
    raise exception 'صلاحيتك لا تسمح بإلغاء السندات (billing.void)';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'إلغاء السند يحتاج سببًا مكتوبًا';
  end if;
  if v_v.is_void then raise exception 'السند ملغى أصلًا'; end if;

  -- سندٌ في مناوبة مغلقة لا يُلغى: المناوبة جُردت واعتُمدت على أساسه.
  if v_v.cash_shift_id is not null
     and (select status from cash_register_shifts where id = v_v.cash_shift_id) <> 'open' then
    raise exception 'السند يخصّ مناوبة مغلقة — التصحيح بسند عكسي لا بالإلغاء';
  end if;

  update financial_vouchers
     set is_void = true, voided_at = now(), voided_by = auth.uid(),
         void_reason = btrim(p_reason)
   where id = p_voucher_id;

  for v_inv in select distinct sales_invoice_id from voucher_invoice_allocations
                where voucher_id = p_voucher_id
  loop
    perform app_recalc_invoice_paid_amount(v_inv);
  end loop;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_v.organization_id, auth.uid(), 'billing', 'update', p_voucher_id,
          'سند مالي', format('إلغاء سند %s بقيمة %s', v_v.voucher_type, v_v.amount),
          btrim(p_reason));
end;
$$;

-- السند لا يُحذف
create or replace function app_block_voucher_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'السندات المالية لا تُحذف — استخدم الإلغاء';
end;
$$;

drop trigger if exists trg_block_voucher_delete on financial_vouchers;
create trigger trg_block_voucher_delete before delete on financial_vouchers
  for each row execute function app_block_voucher_delete();

-- ---------------------------------------------------------------------------
-- 6.5) بند يدوي وخصم — بصلاحية وسبب
-- ---------------------------------------------------------------------------
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
  v_inv sales_invoices%rowtype;
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
  if coalesce(p_amount, 0) < 0 or p_amount > coalesce(v_inv.subtotal_amount, 0) then
    raise exception 'قيمة الخصم غير مقبولة';
  end if;

  update sales_invoices set
    discount_amount = p_amount,
    discount_reason = btrim(p_reason),
    discount_by     = auth.uid(),
    net_amount      = coalesce(subtotal_amount, 0) - p_amount + coalesce(vat_amount, 0),
    updated_by      = auth.uid()
  where id = p_invoice_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_inv.organization_id, auth.uid(), 'billing', 'update', p_invoice_id,
          'فاتورة مبيعات', format('خصم %s', p_amount), btrim(p_reason));
end;
$$;

-- ===========================================================================
-- 7) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in
    select * from (values
      ('cash_register_shifts', 'billing.view', 'cashier.open'),
      ('cash_registers',       'billing.view', 'cashier.approve')
    ) as v(t, pv, pw)
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy if exists %I on %I', pol.policyname, r.t);
    end loop;
    execute format('alter table %I enable row level security', r.t);
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

grant select, insert, update on cash_register_shifts to authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_create_invoice_from_visit','app_set_invoice_status',
                         'app_receive_invoice_payment','app_refund_invoice_payment',
                         'app_void_financial_voucher','app_open_cash_shift',
                         'app_close_cash_shift','app_approve_cash_shift',
                         'app_cash_shift_expected','app_apply_invoice_discount',
                         'app_invoice_status_allowed')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 8) المناظير
-- ===========================================================================

create or replace view v_invoice_register
with (security_invoker = on) as
select
  i.id, i.organization_id, i.branch_id, b.name as branch_name,
  i.invoice_number, i.invoice_type, i.status,
  i.created_at, i.issued_at, i.voided_at, i.void_reason,
  i.patient_id, p.name_ar as patient_name, p.file_number,
  i.visit_id, i.appointment_id,
  d.name_ar as doctor_name, c.name as clinic_name,
  i.subtotal_amount, i.discount_amount, i.vat_amount, i.net_amount,
  i.paid_amount, i.refunded_amount, i.remaining_amount,
  i.is_insurance_invoice, i.insurance_company_name,
  i.patient_share_amount, i.insurance_share_amount,
  (select count(*) from sales_invoice_items li where li.invoice_id = i.id) as lines_count,
  (select count(*) from insurance_claim_forms f where f.sales_invoice_id = i.id) as claims_count,
  case
    when i.status = 'void'  then null
    when i.status = 'draft' then null
    else (current_date - i.issued_at::date)
  end as age_days,
  (i.status in ('unpaid','partial') and i.issued_at < now() - interval '30 days') as is_overdue
from sales_invoices i
left join patients p on p.id = i.patient_id
left join branches b on b.id = i.branch_id
left join doctors  d on d.id = i.doctor_id
left join clinics  c on c.id = i.clinic_id;

comment on view v_invoice_register is
  'سجل الفواتير: ما صدر وما حُصّل وما بقي، ومن أيّ زيارة، ومع أيّ مطالبة.';

create or replace view v_cash_shift_summary
with (security_invoker = on) as
select
  s.id, s.organization_id, s.branch_id, s.cash_register_id,
  r.name as register_name, b.name as branch_name,
  s.shift_number, s.status, s.opened_at, s.closed_at,
  s.opening_balance,
  coalesce((select sum(v.amount) from financial_vouchers v
             where v.cash_shift_id = s.id and v.voucher_type = 'receipt' and not v.is_void), 0)
    as total_receipts,
  coalesce((select sum(v.amount) from financial_vouchers v
             where v.cash_shift_id = s.id and v.voucher_type = 'expense' and not v.is_void), 0)
    as total_expenses,
  coalesce((select count(*) from financial_vouchers v
             where v.cash_shift_id = s.id and not v.is_void), 0) as voucher_count,
  s.expected_balance, s.counted_balance, s.variance_amount, s.variance_reason,
  s.opened_by, s.closed_by, s.approved_by
from cash_register_shifts s
join cash_registers r on r.id = s.cash_register_id
left join branches b on b.id = s.branch_id;

create or replace view v_patient_balance
with (security_invoker = on) as
select
  p.id as patient_id, p.organization_id, p.name_ar as patient_name, p.file_number,
  coalesce(sum(i.net_amount) filter (where i.status not in ('void','draft')), 0) as total_billed,
  coalesce(sum(i.paid_amount) filter (where i.status not in ('void','draft')), 0) as total_paid,
  coalesce(sum(i.refunded_amount) filter (where i.status not in ('void','draft')), 0) as total_refunded,
  coalesce(sum(i.remaining_amount) filter (where i.status in ('unpaid','partial')), 0) as balance_due,
  count(i.id) filter (where i.status in ('unpaid','partial')) as open_invoices,
  max(i.issued_at) as last_invoice_at
from patients p
left join sales_invoices i on i.patient_id = p.id
group by p.id, p.organization_id, p.name_ar, p.file_number;

comment on view v_patient_balance is
  'ذمّة المريض: ما فُوتر وما سُدّد وما بقي. كانت تُحسب في الواجهة لكل شاشة على حدة.';

grant select on v_invoice_register, v_cash_shift_summary, v_patient_balance to authenticated;

-- ===========================================================================
-- 9) فحص ذاتي
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_allocation_amount') then
    raise exception 'حارس تجاوز الدفع غير مركَّب';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_invoice_source_once') then
    raise exception 'منع فوترة المصدر مرّتين غير مركَّب';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_one_open_shift_per_register') then
    raise exception 'منع تعدّد المناوبات المفتوحة غير مركَّب';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc
       where proname = 'app_recalc_invoice_paid_amount' limit 1) not like '%void%' then
    raise exception 'حساب المدفوع ما زال يتجاوز الفواتير الملغاة';
  end if;
end $$;


-- ==========================================================================
-- [3/11]  0092_vat_and_zatca.sql
--          الضريبة والفوترة الإلكترونية
-- ==========================================================================

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


-- ==========================================================================
-- [4/11]  0093_insurance_claims_and_nphies.sql
--          مطالبات التأمين وNPHIES
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0093 — التأمين والمطالبات وطبقة NPHIES
-- ---------------------------------------------------------------------------
-- المرحلة الثالثة عشرة. تعتمد على 0091 و0092: المطالبة تُبنى على خدمات
-- سريرية منفَّذة وفاتورة محسوبة نهائيًّا.
--
-- **الحصر أوّلًا:** 0089 بنى الأساس — `insurance_contracts` و
-- `insurance_coverage_rules` و`insurance_networks`، و`app_insurance_coverage`
-- و`app_active_preauthorization` و`app_set_claim_form_status` و
-- `app_resubmit_claim_form`، وسقوف مستهلَكة في `v_membership_limit_usage`.
--
-- فهذه الهجرة **تُكمل** ما بقي، ولا تعيد بناء ما بُني:
--
--   1) **الأهلية لحظية لا تاريخية.** `app_insurance_coverage` تحسب التغطية
--      وتُعيدها، ولا تحفظ شيئًا. فإذا نازعت الشركة بعد شهر: «لم يكن مؤهَّلًا
--      يوم الخدمة» — لا دليل. الأهلية تُحفَظ بنتيجتها ووقتها.
--   2) **الموافقة بحالات أربع فقط.** `pending/approved/rejected/expired` بلا
--      «جاهزة للإرسال» ولا «قيد المراجعة» ولا «موافقة جزئية» — والجزئية هي
--      أكثر ردود الشركات شيوعًا.
--   3) **لا مطالبة من الزيارة.** `insurance_claim_forms` تُملأ يدويًّا بندًا
--      بندًا؛ فما نسيه الموظف لا يُطالَب به.
--   4) **الرفض على مستوى المطالبة لا البند.** الشركة ترفض بندًا وتقبل ثلاثة،
--      والنظام يعرف «مرفوضة» أو «مقبولة» فقط.
--   5) **لا تسويات.** لا سبيل لتسجيل دفعة شركة تأمين ومطابقتها بمطالبات، ولا
--      لمعرفة الفرق بين المطالَب به والمحصَّل.
--   6) **لا طبقة نقل.** حقول نفيس في 0089 بيانات مسطَّحة على المطالبة، بلا
--      رسالة ولا محاولة ولا استجابة ولا فصل بين منطقنا وبروتوكولهم.
--
-- **لا مفاتيح ربط ولا إرسال حقيقيّ هنا.** الجدول يخزّن الرسائل ويستقبل
-- نتائجها؛ ومن يرسل فعلًا هو خدمة خلفية محميّة، لا المتصفّح ولا هذه الهجرة.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1) الأهلية محفوظة تاريخيًّا
-- ===========================================================================

create table if not exists insurance_eligibility_checks (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  patient_id        uuid not null references patients(id),
  membership_id     uuid references patient_insurance_memberships(id),
  contract_id       uuid references insurance_contracts(id),
  visit_id          uuid references patient_visits(id),
  item_id           uuid references items(id),
  checked_at        timestamptz not null default now(),
  checked_by        uuid references auth.users(id),
  source            text not null default 'internal'
                      check (source in ('internal','nphies','manual','payer_portal')),
  is_eligible       boolean not null,
  coverage_result   jsonb not null,
  copay_percent     numeric,
  patient_share     numeric,
  insurer_share     numeric,
  annual_remaining  numeric,
  requires_preauth  boolean not null default false,
  blocks            jsonb,
  warnings          jsonb,
  reference_number  text,
  valid_until       timestamptz,
  created_at        timestamptz not null default now()
);

comment on table insurance_eligibility_checks is
  'نتيجة التحقّق من الأهلية **محفوظة بوقتها**. الحساب اللحظي لا يصلح دليلًا حين تنازع الشركة بعد شهر: «لم يكن مؤهَّلًا يوم الخدمة».';

create index if not exists idx_eligibility_lookup
  on insurance_eligibility_checks (organization_id, patient_id, checked_at desc);
create index if not exists idx_eligibility_visit
  on insurance_eligibility_checks (visit_id) where visit_id is not null;

alter table insurance_eligibility_checks enable row level security;

/**
 * التحقّق من الأهلية — يحسب **ويحفظ**.
 *
 * يبني على `app_insurance_coverage` (0089) ولا يكرّر منطقها. الجديد أن
 * النتيجة تُخزَّن بوقتها ومرجعها، فتصير سجلًّا يُحتجّ به.
 */
create or replace function app_check_insurance_eligibility(
  p_membership_id uuid,
  p_item_id       uuid default null,
  p_visit_id      uuid default null,
  p_amount        numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m    patient_insurance_memberships%rowtype;
  v_cov  jsonb;
  v_id   uuid;
  v_item uuid;
begin
  select * into v_m from patient_insurance_memberships where id = p_membership_id;
  if v_m.id is null then raise exception 'العضوية التأمينية غير موجودة'; end if;
  if not app_has_permission(v_m.organization_id, 'insurance.view') then
    raise exception 'صلاحيتك لا تسمح بالتحقّق من الأهلية (insurance.view)';
  end if;

  -- بلا خدمة محدّدة نفحص أهلية العضوية نفسها بأيّ صنف استشارة متاح؛ وإن لم
  -- يوجد فالفحص على العضوية وحدها.
  v_item := coalesce(p_item_id, (
    select i.id from items i
     where i.organization_id = v_m.organization_id
       and i.item_type = 'service' and not i.is_archived
     order by case when i.medical_service_type = 'consultation' then 0 else 1 end
     limit 1));

  if v_item is null then
    raise exception 'لا خدمة في الكتالوج للتحقّق بها — أضف خدمة واحدة على الأقل';
  end if;

  v_cov := app_insurance_coverage(p_membership_id, v_item, p_amount);

  insert into insurance_eligibility_checks (
    organization_id, patient_id, membership_id, contract_id, visit_id, item_id,
    checked_by, source, is_eligible, coverage_result,
    copay_percent, patient_share, insurer_share, annual_remaining,
    requires_preauth, blocks, warnings, valid_until)
  values (
    v_m.organization_id, v_m.patient_id, p_membership_id,
    nullif(v_cov->>'contract_id', '')::uuid, p_visit_id, p_item_id,
    auth.uid(), 'internal',
    coalesce((v_cov->>'ok')::boolean, false), v_cov,
    (v_cov->>'copay_percent')::numeric, (v_cov->>'patient_share')::numeric,
    (v_cov->>'insurer_share')::numeric, (v_cov->>'annual_remaining')::numeric,
    coalesce((v_cov->>'requires_preauth')::boolean, false),
    v_cov->'blocks', v_cov->'warnings',
    -- الأهلية تُعاد قراءتها كل يوم: العضوية قد تُلغى بين موعدٍ وموعد.
    now() + interval '1 day')
  returning id into v_id;

  return v_id;
end;
$$;

-- ===========================================================================
-- 2) الموافقات المسبقة: دورة كاملة
-- ===========================================================================

alter table insurance_preauthorizations
  add column if not exists diagnoses          jsonb,
  add column if not exists justification      text,
  add column if not exists attachments        jsonb,
  add column if not exists approved_qty       numeric,
  add column if not exists submitted_at       timestamptz,
  add column if not exists submitted_by       uuid references auth.users(id),
  add column if not exists payer_reference    text,
  add column if not exists eligibility_check_id uuid references insurance_eligibility_checks(id);

do $$
begin
  alter table insurance_preauthorizations drop constraint if exists insurance_preauthorizations_status_check;
  -- **`pending` تبقى مقبولة.** هي القيمة الافتراضية للعمود منذ 0016، وشاشات
  -- ومسارات قائمة تُدرج بها. حذفها من القائمة كسر دليلين من الأدلّة السابقة
  -- فورًا، وهذا هو ما ردّها. تُعامَل معاملة `submitted`: طلبٌ أُرسل ولم يُردّ.
  alter table insurance_preauthorizations add constraint insurance_preauthorizations_status_check check (
    status in ('draft','ready','pending','submitted','in_review','approved',
               'partially_approved','rejected','expired','cancelled')
  );
end $$;

-- والافتراض الجديد `draft`: الطلب يُبنى ثم يُرسل، ولا يولد مُرسَلًا.
alter table insurance_preauthorizations alter column status set default 'draft';

create or replace function app_preauth_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'draft'      then p_to in ('ready','cancelled')
    when 'ready'      then p_to in ('submitted','draft','cancelled')
    when 'submitted'  then p_to in ('in_review','approved','partially_approved','rejected','cancelled')
    when 'in_review'  then p_to in ('approved','partially_approved','rejected','cancelled')
    when 'approved'   then p_to in ('expired','cancelled')
    when 'partially_approved' then p_to in ('expired','cancelled')
    when 'pending'    then p_to in ('approved','partially_approved','rejected','expired','cancelled')
    else false   -- rejected و expired و cancelled نهائية
  end;
$$;

-- الصفوف القائمة على `pending` تبقى كما هي: ترحيلها يغيّر تاريخًا لم يُوثَّق،
-- وخريطة الانتقالات تعرف كيف تخرج منها.

-- **تُسقَط نسخة 0089 أوّلًا.** إضافة معامل جديد تُنشئ تحميلًا زائدًا لا
-- تستبدل الدالة، فيصير النداء بستّة معاملات غامضًا بين نسختين — وهو خطأ
-- تشغيليّ يظهر عند أوّل استدعاء من الواجهة لا في الهجرة.
drop function if exists app_set_preauth_status(uuid, text, text, numeric, text, date);

-- الموافقة الجزئية تحمل الكمية والمبلغ المعتمدَين.
create or replace function app_set_preauth_status(
  p_preauth_id uuid,
  p_status     text,
  p_reason     text default null,
  p_amount     numeric default null,
  p_approval_number text default null,
  p_valid_to   date default null,
  p_qty        numeric default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pa insurance_preauthorizations%rowtype;
begin
  select * into v_pa from insurance_preauthorizations where id = p_preauth_id for update;
  if v_pa.id is null then raise exception 'الموافقة غير موجودة'; end if;
  if not app_has_permission(v_pa.organization_id, 'insurance.preauth') then
    raise exception 'صلاحيتك لا تسمح بإدارة الموافقات المسبقة (insurance.preauth)';
  end if;
  if v_pa.status = p_status then return; end if;
  if not app_preauth_status_allowed(v_pa.status, p_status) then
    raise exception 'لا يمكن الانتقال بالموافقة من «%» إلى «%»', v_pa.status, p_status;
  end if;

  if p_status = 'rejected' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'الرفض يحتاج سببًا مكتوبًا';
  end if;
  if p_status in ('approved','partially_approved')
     and coalesce(btrim(p_approval_number), '') = '' then
    raise exception 'الاعتماد يحتاج رقم موافقة من شركة التأمين';
  end if;
  if p_status = 'partially_approved' and p_amount is null and p_qty is null then
    raise exception 'الاعتماد الجزئي يحتاج المبلغ أو الكمية المعتمدة';
  end if;
  if p_status = 'ready' and coalesce(btrim(v_pa.justification), '') = '' then
    raise exception 'الإرسال يحتاج مبرّرًا طبيًّا مكتوبًا';
  end if;

  update insurance_preauthorizations set
    status           = p_status,
    submitted_at     = case when p_status = 'submitted' then now() else submitted_at end,
    submitted_by     = case when p_status = 'submitted' then auth.uid() else submitted_by end,
    responded_at     = case when p_status in ('approved','partially_approved','rejected')
                            then now() else responded_at end,
    approval_number  = case when p_status in ('approved','partially_approved')
                            then btrim(p_approval_number) else approval_number end,
    approved_amount  = case when p_status = 'approved' then coalesce(p_amount, requested_amount)
                            when p_status = 'partially_approved' then p_amount
                            else approved_amount end,
    approved_qty     = case when p_status = 'approved' then coalesce(p_qty, qty)
                            when p_status = 'partially_approved' then p_qty
                            else approved_qty end,
    valid_from       = case when p_status in ('approved','partially_approved')
                            then coalesce(valid_from, current_date) else valid_from end,
    valid_to         = case when p_status in ('approved','partially_approved')
                            then coalesce(p_valid_to, valid_to, current_date + 90) else valid_to end,
    rejection_reason = case when p_status = 'rejected' then btrim(p_reason) else rejection_reason end,
    updated_at       = now(),
    updated_by       = auth.uid()
  where id = p_preauth_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pa.organization_id, auth.uid(), 'insurance', 'update', p_preauth_id,
          'موافقة مسبقة', format('%s ← %s', v_pa.status, p_status),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- `app_active_preauthorization` تشمل الجزئية أيضًا: موافقةٌ على بعض الكمية
-- موافقةٌ سارية على ذلك البعض.
create or replace function app_active_preauthorization(
  p_patient_id uuid,
  p_item_id    uuid,
  p_as_of      date default current_date
)
returns insurance_preauthorizations
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.*
    from insurance_preauthorizations p
   where p.patient_id = p_patient_id
     and p.item_id    = p_item_id
     and p.status in ('approved','partially_approved')
     and p.consumed_at is null
     and coalesce(p.valid_from, p.responded_at::date, p.requested_at::date) <= p_as_of
     and coalesce(p.valid_to,
                  coalesce(p.responded_at, p.requested_at)::date + 90) >= p_as_of
     and app_is_member(p.organization_id)
   order by coalesce(p.responded_at, p.requested_at) desc
   limit 1;
$$;

-- ===========================================================================
-- 3) المطالبة: بنودها ورفضها على مستوى البند
-- ===========================================================================

alter table insurance_claim_form_items
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists visit_service_id uuid references patient_visit_services(id),
  add column if not exists invoice_item_id  uuid references sales_invoice_items(id),
  add column if not exists icd10_code_id    uuid,
  add column if not exists claimed_amount   numeric,
  add column if not exists approved_amount  numeric,
  add column if not exists rejected_amount  numeric,
  add column if not exists rejection_code   text,
  add column if not exists rejection_reason text,
  add column if not exists preauthorization_id uuid references insurance_preauthorizations(id),
  add column if not exists status           text not null default 'claimed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_item_status_check') then
    alter table insurance_claim_form_items add constraint claim_item_status_check check (
      status in ('claimed','approved','partially_approved','rejected','resubmitted')
    );
  end if;
end $$;

update insurance_claim_form_items li
   set organization_id = coalesce(li.organization_id, f.organization_id),
       claimed_amount  = coalesce(li.claimed_amount, li.amount)
  from insurance_claim_forms f
 where f.id = li.form_id and li.organization_id is null;

create index if not exists idx_claim_items_form on insurance_claim_form_items (form_id);

alter table insurance_claim_forms
  add column if not exists visit_id            uuid references patient_visits(id),
  add column if not exists contract_id         uuid references insurance_contracts(id),
  add column if not exists eligibility_check_id uuid references insurance_eligibility_checks(id),
  add column if not exists diagnoses           jsonb,
  add column if not exists validation_errors   jsonb,
  add column if not exists settled_amount      numeric not null default 0,
  add column if not exists version_number      integer not null default 1;

do $$
begin
  alter table insurance_claim_forms drop constraint if exists insurance_claim_forms_status_check;
  alter table insurance_claim_forms add constraint insurance_claim_forms_status_check check (
    status in ('draft','validation_failed','ready','submitted','acknowledged','in_review',
               'approved','partially_approved','rejected','resubmitted','settled','paid','cancelled')
  );
end $$;

create or replace function app_claim_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    -- `draft → submitted` مباشرةً مسموح أيضًا: `ready` خطوةٌ لمن يفصل التجهيز
    -- عن الإرسال، لا ضريبةٌ على من يفعلهما معًا. وحذفها كسر دليل المرحلة ٩.
    when 'draft'              then p_to in ('ready','submitted','validation_failed','cancelled')
    when 'validation_failed'  then p_to in ('draft','ready','cancelled')
    when 'ready'              then p_to in ('submitted','draft','cancelled')
    when 'submitted'          then p_to in ('acknowledged','in_review','approved',
                                            'partially_approved','rejected','cancelled')
    when 'acknowledged'       then p_to in ('in_review','approved','partially_approved','rejected')
    when 'in_review'          then p_to in ('approved','partially_approved','rejected')
    when 'approved'           then p_to in ('settled','paid','rejected')
    when 'partially_approved' then p_to in ('settled','paid','resubmitted','rejected')
    when 'rejected'           then p_to in ('resubmitted','cancelled')
    when 'settled'            then p_to in ('paid')
    else false   -- paid و resubmitted و cancelled نهائية
  end;
$$;

/**
 * إنشاء المطالبة من الزيارة.
 *
 * يجمع التشخيصات والخدمات المفوترة، ويربط أكواد المطالبات، ويتحقّق من
 * الموافقات، ويحسب حصّتَي المريض والشركة من الفاتورة نفسها لا من حسابٍ ثانٍ،
 * ويكشف الناقص بدل أن يُرسل مطالبة تُرفض شكلًا.
 *
 * ويمنع التكرار: زيارةٌ لها مطالبة حيّة لا تُطالَب بها مرّتين.
 */
create or replace function app_create_claim_from_visit(
  p_visit_id   uuid,
  p_invoice_id uuid default null,
  p_form_type  text default 'ucaf'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit   patient_visits%rowtype;
  v_inv     sales_invoices%rowtype;
  v_member  patient_insurance_memberships%rowtype;
  v_contract insurance_contracts%rowtype;
  v_company uuid;
  v_form    uuid;
  v_elig    uuid;
  v_line    record;
  v_errors  jsonb := '[]'::jsonb;
  v_diag    jsonb;
  v_total   numeric := 0;
  v_n       int := 0;
  v_pa      insurance_preauthorizations%rowtype;
  v_code    text;
begin
  select * into v_visit from patient_visits where id = p_visit_id for update;
  if v_visit.id is null then raise exception 'الزيارة غير موجودة'; end if;
  if not app_has_permission(v_visit.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بإنشاء المطالبات (insurance.claims)';
  end if;

  -- **لا مطالبة مكرّرة.**
  if exists (select 1 from insurance_claim_forms f
              where f.visit_id = p_visit_id
                and f.status not in ('cancelled','rejected','resubmitted')) then
    raise exception 'للزيارة مطالبة قائمة — ألغِها أو أعد تقديمها بدل إنشاء ثانية';
  end if;

  -- الفاتورة
  if p_invoice_id is not null then
    select * into v_inv from sales_invoices where id = p_invoice_id;
  else
    select * into v_inv from sales_invoices
     where visit_id = p_visit_id and status <> 'void'
       and document_type not in ('credit_note','debit_note')
     order by created_at desc limit 1;
  end if;
  if v_inv.id is null then
    raise exception 'لا فاتورة لهذه الزيارة — المطالبة تُبنى على فاتورة محسوبة';
  end if;
  if v_inv.issued_at is null then
    raise exception 'الفاتورة مسوّدة — أصدرها قبل المطالبة';
  end if;

  -- العضوية والعقد
  select * into v_member from patient_insurance_memberships
   where patient_id = v_visit.patient_id and is_active
     and (expiry_date is null or expiry_date >= current_date)
   order by created_at desc limit 1;
  if v_member.id is null then
    raise exception 'لا عضوية تأمينية سارية لهذا المريض';
  end if;
  select company_id into v_company from insurance_policies where id = v_member.policy_id;
  v_contract := app_active_insurance_contract(v_visit.organization_id, v_company, current_date);

  -- الأهلية تُحفَظ مع المطالبة
  v_elig := app_check_insurance_eligibility(v_member.id, null, p_visit_id, null);

  -- التشخيصات
  select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name_ar))
    into v_diag
    from patient_visit_diagnoses d
    join icd10_codes c on c.id = d.icd10_code_id
   where d.visit_id = p_visit_id;

  if v_diag is null then
    v_errors := v_errors || jsonb_build_object(
      'field', 'diagnoses', 'message', 'لا تشخيص مسجَّل على الزيارة — المطالبة بلا تشخيص تُرفض');
  end if;
  if v_contract.id is null then
    v_errors := v_errors || jsonb_build_object(
      'field', 'contract', 'message', 'لا عقد ساري مع شركة التأمين');
  end if;

  insert into insurance_claim_forms (
    organization_id, form_type, patient_id, doctor_id, clinic_id, membership_id,
    sales_invoice_id, visit_id, contract_id, eligibility_check_id, status,
    diagnoses, form_data, auto_created, created_by)
  values (
    v_visit.organization_id, p_form_type, v_visit.patient_id, v_visit.doctor_id,
    v_visit.clinic_id, v_member.id, v_inv.id, p_visit_id, v_contract.id, v_elig,
    'draft', v_diag, '{}'::jsonb, false, auth.uid())
  returning id into v_form;

  -- البنود من الفاتورة: ما له حصّة تأمين
  for v_line in
    select li.*, i.name_ar
      from sales_invoice_items li
      left join items i on i.id = li.item_id
     where li.invoice_id = v_inv.id
       and coalesce(li.insurer_share, 0) > 0
  loop
    v_code := app_item_claim_code(v_line.item_id, v_company);

    if v_code is null then
      v_errors := v_errors || jsonb_build_object(
        'field', 'service_code', 'item', coalesce(v_line.item_name_snapshot, v_line.name_ar),
        'message', 'لا كود مطالبة لهذه الخدمة لدى الشركة');
    end if;

    -- **الموافقة تُقرأ من سطر الفاتورة أوّلًا.** 0090 يستهلك الموافقة لحظة
    -- الفوترة ويختم معرّفها على السطر؛ فالبحث عن «موافقة سارية» هنا لا يجد
    -- شيئًا — وقد استُعملت فعلًا. المطالبة تستشهد بالموافقة التي بُنيت عليها
    -- الفاتورة، لا بأخرى ما زالت مفتوحة.
    if v_line.preauthorization_id is not null then
      select * into v_pa from insurance_preauthorizations where id = v_line.preauthorization_id;
    else
      v_pa := app_active_preauthorization(v_visit.patient_id, v_line.item_id, current_date);
    end if;

    insert into insurance_claim_form_items (
      organization_id, form_id, item_id, service_code, description, qty, amount,
      invoice_item_id, visit_service_id, claimed_amount, preauthorization_id, status)
    values (
      v_visit.organization_id, v_form, v_line.item_id, v_code,
      coalesce(v_line.item_name_snapshot, v_line.name_ar), v_line.qty,
      v_line.insurer_share, v_line.id, v_line.visit_service_id,
      v_line.insurer_share, v_pa.id, 'claimed');

    v_total := v_total + coalesce(v_line.insurer_share, 0);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'لا بند في الفاتورة عليه حصّة تأمين';
  end if;

  update insurance_claim_forms set
    claimed_amount    = v_total,
    validation_errors = case when jsonb_array_length(v_errors) > 0 then v_errors else null end,
    status            = case when jsonb_array_length(v_errors) > 0
                             then 'validation_failed' else 'draft' end,
    membership_snapshot = jsonb_build_object(
      'membership_number', v_member.membership_number,
      'policy_id',         v_member.policy_id,
      'expiry_date',       v_member.expiry_date,
      'copay_percent',     v_member.copay_percent_override),
    updated_at = now()
  where id = v_form;

  -- خدمات الزيارة تُعلَّم مُطالَبًا بها
  update patient_visit_services s
     set status = 'claimed', status_changed_at = now(), status_changed_by = auth.uid()
    from insurance_claim_form_items ci
   where ci.form_id = v_form and ci.visit_service_id = s.id and s.status in ('invoiced','paid');

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_visit.organization_id, auth.uid(), 'insurance', 'add', v_form,
          'مطالبة تأمين',
          format('أُنشئت من زيارة بـ%s بندًا، المطالَب %s%s', v_n, v_total,
                 case when jsonb_array_length(v_errors) > 0
                      then format(' — %s ملاحظة تحقّق', jsonb_array_length(v_errors))
                      else '' end));

  return v_form;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3.1) الردّ على مستوى البند
-- ---------------------------------------------------------------------------
create or replace function app_record_claim_item_response(
  p_item_id  uuid,
  p_status   text,
  p_approved numeric default null,
  p_code     text default null,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_it insurance_claim_form_items%rowtype;
  v_f  insurance_claim_forms%rowtype;
  v_app numeric;
  v_rej numeric;
  v_all_rejected boolean;
  v_any_rejected boolean;
begin
  select * into v_it from insurance_claim_form_items where id = p_item_id for update;
  if v_it.id is null then raise exception 'بند المطالبة غير موجود'; end if;
  select * into v_f from insurance_claim_forms where id = v_it.form_id for update;
  if not app_has_permission(v_f.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بتسجيل الردّ (insurance.claims)';
  end if;
  if p_status not in ('approved','partially_approved','rejected') then
    raise exception 'حالة غير مقبولة للبند: %', p_status;
  end if;
  -- **الرفض بلا كود ولا سبب لا يُبنى عليه اعتراض.** وهذا هو الفرق بين
  -- مطالبة تُستعاد وأخرى تُشطب.
  if p_status in ('rejected','partially_approved')
     and coalesce(btrim(p_reason), '') = '' then
    raise exception 'الرفض أو الاعتماد الجزئي يحتاج سببًا مكتوبًا';
  end if;
  if p_status = 'partially_approved' and p_approved is null then
    raise exception 'الاعتماد الجزئي يحتاج المبلغ المعتمَد';
  end if;
  if coalesce(p_approved, 0) > coalesce(v_it.claimed_amount, 0) + 0.001 then
    raise exception 'المعتمَد % يتجاوز المطالَب به %', p_approved, v_it.claimed_amount;
  end if;

  v_app := case p_status when 'approved' then coalesce(p_approved, v_it.claimed_amount)
                         when 'partially_approved' then p_approved
                         else 0 end;
  v_rej := greatest(coalesce(v_it.claimed_amount, 0) - v_app, 0);

  update insurance_claim_form_items set
    status           = p_status,
    approved_amount  = v_app,
    rejected_amount  = v_rej,
    rejection_code   = nullif(btrim(coalesce(p_code, '')), ''),
    rejection_reason = case when p_status = 'approved' then null else btrim(p_reason) end
  where id = p_item_id;

  -- حالة المطالبة تُشتقّ من بنودها لا تُكتب يدويًّا
  select bool_and(status = 'rejected'), bool_or(status in ('rejected','partially_approved'))
    into v_all_rejected, v_any_rejected
    from insurance_claim_form_items where form_id = v_f.id;

  if not exists (select 1 from insurance_claim_form_items
                  where form_id = v_f.id and status = 'claimed') then
    update insurance_claim_forms set
      approved_amount = (select coalesce(sum(approved_amount), 0)
                           from insurance_claim_form_items where form_id = v_f.id),
      rejected_amount = (select coalesce(sum(rejected_amount), 0)
                           from insurance_claim_form_items where form_id = v_f.id),
      status = case when v_all_rejected then 'rejected'
                    when v_any_rejected then 'partially_approved'
                    else 'approved' end,
      responded_at = now(),
      updated_at = now()
    where id = v_f.id
      and app_claim_status_allowed(v_f.status,
            case when v_all_rejected then 'rejected'
                 when v_any_rejected then 'partially_approved'
                 else 'approved' end);
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_f.organization_id, auth.uid(), 'insurance', 'update', v_f.id,
          'بند مطالبة', format('%s: معتمَد %s ومرفوض %s', p_status, v_app, v_rej),
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- ===========================================================================
-- 4) التسويات المالية
-- ===========================================================================

create table if not exists insurance_settlements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  company_id       uuid not null references insurance_companies(id),
  contract_id      uuid references insurance_contracts(id),
  settlement_number bigint,
  settlement_date  date not null default current_date,
  reference_number text,
  total_claimed    numeric not null default 0,
  total_approved   numeric not null default 0,
  total_rejected   numeric not null default 0,
  total_paid       numeric not null default 0,
  payment_voucher_id uuid references financial_vouchers(id),
  status           text not null default 'draft'
                     check (status in ('draft','matched','paid','closed')),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);

comment on table insurance_settlements is
  'تسوية دفعة شركة تأمين مع مطالبة أو عدّة مطالبات. بلا تسوية لا يُعرف الفرق بين المطالَب به والمحصَّل.';

create table if not exists insurance_settlement_claims (
  id             uuid primary key default gen_random_uuid(),
  settlement_id  uuid not null references insurance_settlements(id) on delete cascade,
  claim_form_id  uuid not null references insurance_claim_forms(id),
  claimed_amount numeric not null default 0,
  approved_amount numeric not null default 0,
  paid_amount    numeric not null default 0,
  variance_amount numeric generated always as (paid_amount - approved_amount) stored,
  note           text,
  created_at     timestamptz not null default now()
);

create unique index if not exists uq_settlement_claim
  on insurance_settlement_claims (settlement_id, claim_form_id);

alter table insurance_settlements enable row level security;
alter table insurance_settlement_claims enable row level security;

/**
 * تسجيل دفعة شركة التأمين ومطابقتها.
 *
 * **لا تحوّل المرفوض إلى المريض تلقائيًّا.** ذلك قرار سياسة لا حساب: بعض
 * الرفض خطأ ترميز يُصحَّح ويُعاد تقديمه، وتحميله على المريض فورًا يخسره
 * ويخسر حقّ المنشأة معًا. تبقى المبالغ المرفوضة ظاهرة في `v_claim_settlement`
 * لقرارٍ بشريّ.
 */
create or replace function app_settle_insurance_claims(
  p_company_id uuid,
  p_claims     uuid[],
  p_paid_total numeric,
  p_reference  text default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_id       uuid;
  v_claim    uuid;
  v_f        insurance_claim_forms%rowtype;
  v_claimed  numeric := 0;
  v_approved numeric := 0;
  v_rejected numeric := 0;
  v_share    numeric;
  v_n        bigint;
begin
  select organization_id into v_org from insurance_companies where id = p_company_id;
  if v_org is null then raise exception 'شركة التأمين غير موجودة'; end if;
  if not app_has_permission(v_org, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بالتسويات (insurance.claims)';
  end if;
  if p_claims is null or array_length(p_claims, 1) is null then
    raise exception 'حدّد مطالبة واحدة على الأقل';
  end if;
  if coalesce(p_paid_total, 0) <= 0 then
    raise exception 'مبلغ الدفعة يجب أن يكون أكبر من صفر';
  end if;

  select coalesce(max(settlement_number), 0) + 1 into v_n
    from insurance_settlements where organization_id = v_org;

  insert into insurance_settlements (
    organization_id, company_id, settlement_number, reference_number,
    total_paid, status, note, created_by)
  values (v_org, p_company_id, v_n, nullif(btrim(p_reference), ''),
          p_paid_total, 'matched', nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  foreach v_claim in array p_claims loop
    select * into v_f from insurance_claim_forms where id = v_claim for update;
    if v_f.id is null then raise exception 'المطالبة % غير موجودة', v_claim; end if;
    if v_f.organization_id <> v_org then
      raise exception 'المطالبة تتبع منشأة أخرى';
    end if;
    if v_f.status not in ('approved','partially_approved','settled') then
      raise exception 'المطالبة % — تُسوّى المعتمَدة كليًّا أو جزئيًّا فقط', v_f.status;
    end if;

    v_claimed  := v_claimed + coalesce(v_f.claimed_amount, 0);
    v_approved := v_approved + coalesce(v_f.approved_amount, 0);
    v_rejected := v_rejected + coalesce(v_f.rejected_amount, 0);

    insert into insurance_settlement_claims (
      settlement_id, claim_form_id, claimed_amount, approved_amount)
    values (v_id, v_claim, coalesce(v_f.claimed_amount, 0), coalesce(v_f.approved_amount, 0));
  end loop;

  -- توزيع المدفوع على المطالبات بنسبة المعتمَد لكل منها
  for v_claim in select claim_form_id from insurance_settlement_claims where settlement_id = v_id
  loop
    select approved_amount into v_share from insurance_settlement_claims
     where settlement_id = v_id and claim_form_id = v_claim;
    update insurance_settlement_claims
       set paid_amount = case when v_approved > 0
                              then round(p_paid_total * v_share / v_approved, 2) else 0 end
     where settlement_id = v_id and claim_form_id = v_claim;

    update insurance_claim_forms
       set settled_amount = (select paid_amount from insurance_settlement_claims
                              where settlement_id = v_id and claim_form_id = v_claim),
           status = case when app_claim_status_allowed(status, 'settled') then 'settled'
                         else status end,
           updated_at = now()
     where id = v_claim;
  end loop;

  update insurance_settlements
     set total_claimed = v_claimed, total_approved = v_approved, total_rejected = v_rejected,
         updated_at = now()
   where id = v_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_org, auth.uid(), 'insurance', 'add', v_id, 'تسوية تأمين',
          format('تسوية %s: مطالَب %s، معتمَد %s، مدفوع %s',
                 v_n, v_claimed, v_approved, p_paid_total));

  return v_id;
end;
$$;

-- ===========================================================================
-- 5) طبقة NPHIES — رسائل بلا إرسال
-- ===========================================================================

create table if not exists nphies_messages (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  message_type      text not null
                      check (message_type in ('eligibility','preauthorization','claim',
                                              'claim_response','payment_notice','poll','cancel')),
  direction         text not null default 'outbound'
                      check (direction in ('outbound','inbound')),
  environment       text not null default 'sandbox'
                      check (environment in ('sandbox','production')),
  status            text not null default 'queued'
                      check (status in ('queued','sending','sent','acknowledged',
                                        'completed','failed','cancelled')),
  request_id        text,
  response_id       text,
  correlation_id    uuid,
  eligibility_check_id uuid references insurance_eligibility_checks(id),
  preauthorization_id  uuid references insurance_preauthorizations(id),
  claim_form_id        uuid references insurance_claim_forms(id),
  request_payload   jsonb,
  response_payload  jsonb,
  errors            jsonb,
  attempt_count     integer not null default 0,
  last_attempt_at   timestamptz,
  sent_at           timestamptz,
  responded_at      timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

comment on table nphies_messages is
  'طبقة النقل مع نفيس: نوع الرسالة ومعرّفاها والمحاولات والاستجابة. **مفصولة عن منطق النظام** — المنطق في جداول التأمين، والبروتوكول هنا. لا مفاتيح ربط في هذا الجدول، ولا إرسال من المتصفّح: من يرسل خدمة خلفية محميّة.';

create index if not exists idx_nphies_pending
  on nphies_messages (organization_id, status, created_at)
  where status in ('queued','sending','failed');
create index if not exists idx_nphies_claim on nphies_messages (claim_form_id)
  where claim_form_id is not null;

-- **منع التكرار**: رسالةٌ واحدة حيّة لكل مرجع ونوع. بلا هذا تُرسل المطالبة
-- مرّتين عند أوّل بطء في الشبكة، فتُفتح مطالبتان لخدمة واحدة.
create unique index if not exists uq_nphies_live_message
  on nphies_messages (message_type, coalesce(claim_form_id, preauthorization_id,
                                             eligibility_check_id))
  where status in ('queued','sending','sent') and direction = 'outbound';

alter table nphies_messages enable row level security;

create or replace function app_queue_nphies_message(
  p_organization_id uuid,
  p_message_type    text,
  p_payload         jsonb,
  p_claim_form_id   uuid default null,
  p_preauth_id      uuid default null,
  p_eligibility_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id         uuid;
  v_request_id text;
  v_company    insurance_companies%rowtype;
  v_member_id  uuid;
begin
  if not app_has_permission(p_organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بإرسال رسائل نفيس (insurance.claims)';
  end if;
  if coalesce(p_claim_form_id, p_preauth_id, p_eligibility_id) is null then
    raise exception 'الرسالة يجب أن ترتبط بمطالبة أو موافقة أو أهلية';
  end if;

  -- **الدافع يُحسم قبل الإدراج، لا بعد الإرسال.**
  -- شركة غير مفعَّلة على نفيس أو بلا معرّف دافع تعني رسالةً سترتدّ من البوّابة
  -- بعد أن نكون قد وسمنا المطالبة "مُرسَلة". نمنعها هنا.
  select coalesce(cf.membership_id, pa.membership_id, el.membership_id)
    into v_member_id
    from (select 1) x
    left join insurance_claim_forms      cf on cf.id = p_claim_form_id
    left join insurance_preauthorizations pa on pa.id = p_preauth_id
    left join insurance_eligibility_checks el on el.id = p_eligibility_id;

  if v_member_id is not null then
    select c.* into v_company
      from patient_insurance_memberships m
      join insurance_policies p on p.id = m.policy_id
      join insurance_companies c on c.id = p.company_id
     where m.id = v_member_id;

    if v_company.id is not null then
      if coalesce(v_company.nphies_enabled, false) is not true then
        raise exception 'شركة % غير مفعَّلة على نفيس — فعّلها من بيانات الشركة أولًا',
          coalesce(v_company.name_ar, v_company.name_en, '؟');
      end if;
      if coalesce(nullif(trim(v_company.nphies_payer_id), ''), '') = '' then
        raise exception 'معرّف الدافع (Payer ID) غير مسجَّل للشركة % — لا يمكن تكوين الرسالة',
          coalesce(v_company.name_ar, v_company.name_en, '؟');
      end if;
    end if;
  end if;

  v_request_id := gen_random_uuid()::text;

  insert into nphies_messages (
    organization_id, message_type, request_payload,
    claim_form_id, preauthorization_id, eligibility_check_id,
    request_id, created_by)
  values (
    p_organization_id, p_message_type,
    -- معرّف الدافع جزء من الظرف لا من الأسرار؛ المفاتيح تبقى في الخدمة الخلفية
    coalesce(p_payload, '{}'::jsonb)
      || jsonb_build_object('payer_id', v_company.nphies_payer_id),
    p_claim_form_id, p_preauth_id, p_eligibility_id,
    v_request_id, auth.uid())
  returning id into v_id;

  -- الأعمدة القديمة على نموذج المطالبة تبقى مصدر العرض في شاشات المطالبات،
  -- فنكتب فيها بدل أن نتركها فارغة بجانب جدول الرسائل.
  if p_claim_form_id is not null then
    update insurance_claim_forms
       set nphies_request_id  = v_request_id,
           nphies_status      = 'queued',
           nphies_last_sync_at = now(),
           updated_at         = now()
     where id = p_claim_form_id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (p_organization_id, auth.uid(), 'insurance', 'add', v_id,
          'رسالة نفيس', format('أُدرجت رسالة %s في الطابور', p_message_type));

  return v_id;
end;
$$;

create or replace function app_record_nphies_response(
  p_message_id uuid,
  p_status     text,
  p_response   jsonb default null,
  p_errors     jsonb default null,
  p_response_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m nphies_messages%rowtype;
begin
  select * into v_m from nphies_messages where id = p_message_id for update;
  if v_m.id is null then raise exception 'الرسالة غير موجودة'; end if;
  if not app_has_permission(v_m.organization_id, 'insurance.claims') then
    raise exception 'صلاحيتك لا تسمح بتسجيل الاستجابة (insurance.claims)';
  end if;
  if p_status not in ('sending','sent','acknowledged','completed','failed','cancelled') then
    raise exception 'حالة غير معروفة: %', p_status;
  end if;

  update nphies_messages set
    status          = p_status,
    response_payload = coalesce(p_response, response_payload),
    errors          = coalesce(p_errors, errors),
    response_id     = coalesce(p_response_id, response_id),
    attempt_count   = case when p_status in ('sending','failed')
                           then attempt_count + 1 else attempt_count end,
    last_attempt_at = case when p_status in ('sending','failed') then now() else last_attempt_at end,
    sent_at         = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
    responded_at    = case when p_status in ('acknowledged','completed','failed')
                           then now() else responded_at end,
    updated_at      = now()
  where id = p_message_id;

  -- ترجمة حالة النقل إلى حالة داخلية — الاتجاه الوحيد المسموح بين الطبقتين
  if v_m.claim_form_id is not null then
    -- حالة النقل ومهر آخر مزامنة يُكتبان دائمًا، حتى عند الفشل، ليعرف الموظف
    -- من الشاشة نفسها أين وقفت الرسالة بدل أن يفتح جدول الرسائل.
    update insurance_claim_forms
       set nphies_status       = p_status,
           nphies_last_sync_at = now(),
           updated_at          = now()
     where id = v_m.claim_form_id;

    if p_status = 'sent' then
      update insurance_claim_forms set status = 'submitted', submitted_at = coalesce(submitted_at, now())
       where id = v_m.claim_form_id and app_claim_status_allowed(status, 'submitted');
    elsif p_status = 'acknowledged' then
      update insurance_claim_forms set status = 'acknowledged'
       where id = v_m.claim_form_id and app_claim_status_allowed(status, 'acknowledged');
    end if;
  end if;
end;
$$;

-- ===========================================================================
-- 6) الأذونات وRLS
-- ===========================================================================
do $$
declare r record; pol record;
begin
  for r in
    select * from (values
      ('insurance_eligibility_checks', 'insurance.view', 'insurance.view'),
      ('insurance_settlements',        'insurance.view', 'insurance.claims'),
      ('nphies_messages',              'insurance.view', 'insurance.claims')
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

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'insurance_settlement_claims'
  loop
    execute format('drop policy if exists %I on insurance_settlement_claims', pol.policyname);
  end loop;
  execute $p$create policy isc_select on insurance_settlement_claims for select
    using (exists (select 1 from insurance_settlements s
                    where s.id = insurance_settlement_claims.settlement_id
                      and app_has_permission(s.organization_id, 'insurance.view')))$p$;
  execute $p$create policy isc_write on insurance_settlement_claims for all
    using (exists (select 1 from insurance_settlements s
                    where s.id = insurance_settlement_claims.settlement_id
                      and app_has_permission(s.organization_id, 'insurance.claims')))
    with check (exists (select 1 from insurance_settlements s
                    where s.id = insurance_settlement_claims.settlement_id
                      and app_has_permission(s.organization_id, 'insurance.claims')))$p$;
end $$;

grant select, insert, update on
  insurance_eligibility_checks, insurance_settlements,
  insurance_settlement_claims, nphies_messages to authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_check_insurance_eligibility','app_preauth_status_allowed',
                         'app_create_claim_from_visit','app_record_claim_item_response',
                         'app_settle_insurance_claims','app_queue_nphies_message',
                         'app_record_nphies_response')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 7) المناظير
-- ===========================================================================

create or replace view v_claim_settlement
with (security_invoker = on) as
select
  f.id as claim_form_id, f.organization_id, f.status,
  f.claimed_amount, f.approved_amount, f.rejected_amount, f.settled_amount,
  coalesce(f.approved_amount, 0) - coalesce(f.settled_amount, 0) as unsettled_amount,
  f.submitted_at, f.responded_at,
  case when f.submitted_at is not null and f.responded_at is not null
       then extract(day from f.responded_at - f.submitted_at)::int end as response_days,
  case when f.submitted_at is not null and f.responded_at is null
       then (current_date - f.submitted_at::date) end as days_pending,
  co.id as company_id, co.name_ar as company_name,
  p.name_ar as patient_name, p.file_number,
  d.name_ar as doctor_name,
  f.visit_id, f.sales_invoice_id,
  (select count(*) from insurance_claim_form_items ci
    where ci.form_id = f.id and ci.status = 'rejected')          as rejected_items,
  (select string_agg(distinct ci.rejection_code, '، ')
     from insurance_claim_form_items ci
    where ci.form_id = f.id and ci.rejection_code is not null)   as rejection_codes,
  f.validation_errors is not null                                as has_validation_errors
from insurance_claim_forms f
left join patient_insurance_memberships m on m.id = f.membership_id
left join insurance_policies pol on pol.id = m.policy_id
left join insurance_companies co on co.id = pol.company_id
left join patients p on p.id = f.patient_id
left join doctors d on d.id = f.doctor_id;

comment on view v_claim_settlement is
  'المطالبة من التقديم إلى التحصيل: المطالَب والمعتمَد والمرفوض والمسدَّد، ومدّة المعالجة، وأكواد الرفض.';

create or replace view v_insurance_receivables
with (security_invoker = on) as
select
  co.id as company_id, co.organization_id, co.name_ar as company_name,
  count(f.id)                                     as claim_count,
  sum(coalesce(f.claimed_amount, 0))              as total_claimed,
  sum(coalesce(f.approved_amount, 0))             as total_approved,
  sum(coalesce(f.rejected_amount, 0))             as total_rejected,
  sum(coalesce(f.settled_amount, 0))              as total_settled,
  sum(coalesce(f.approved_amount, 0) - coalesce(f.settled_amount, 0)) as outstanding,
  count(f.id) filter (where f.status = 'rejected')                    as rejected_claims,
  count(f.id) filter (where f.status = 'submitted'
                        and f.submitted_at < now() - interval '30 days') as stale_claims
from insurance_companies co
left join insurance_policies pol on pol.company_id = co.id
left join patient_insurance_memberships m on m.policy_id = pol.id
left join insurance_claim_forms f on f.membership_id = m.id
                                 and f.status not in ('draft','cancelled')
group by co.id, co.organization_id, co.name_ar;

comment on view v_insurance_receivables is
  'ذمم شركات التأمين: المطالَب والمعتمَد والمحصَّل والفرق، وما ركد أكثر من ثلاثين يومًا.';

drop view if exists v_nphies_queue;
create view v_nphies_queue
with (security_invoker = on) as
select
  n.id, n.organization_id, n.message_type, n.direction, n.status, n.environment,
  n.attempt_count, n.last_attempt_at, n.sent_at, n.responded_at, n.errors,
  n.claim_form_id, n.preauthorization_id, n.eligibility_check_id,
  n.request_id,
  cf.nphies_status       as claim_nphies_status,
  cf.nphies_last_sync_at as claim_nphies_last_sync_at,
  comp.name_ar           as payer_name,
  comp.nphies_payer_id   as payer_id,
  (n.status = 'failed' and n.attempt_count >= 3) as needs_manual_review,
  n.created_at
from nphies_messages n
left join insurance_claim_forms cf on cf.id = n.claim_form_id
left join patient_insurance_memberships m
       on m.id = coalesce(cf.membership_id,
                          (select pa.membership_id from insurance_preauthorizations pa
                            where pa.id = n.preauthorization_id),
                          (select el.membership_id from insurance_eligibility_checks el
                            where el.id = n.eligibility_check_id))
left join insurance_policies  pol  on pol.id = m.policy_id
left join insurance_companies comp on comp.id = pol.company_id;

grant select on v_claim_settlement, v_insurance_receivables, v_nphies_queue to authenticated;

-- ===========================================================================
-- 8) فحص ذاتي
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_nphies_live_message') then
    raise exception 'منع تكرار رسائل نفيس غير مركَّب';
  end if;
  if exists (select 1 from nphies_messages where environment = 'production') then
    raise exception 'وُجدت رسالة ببيئة إنتاج — هذه الهجرة لا تُفعّل الإنتاج';
  end if;
  -- لا مفاتيح ولا أسرار في جداول التأمين
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'nphies_messages'
                and column_name in ('api_key','client_secret','certificate','private_key')) then
    raise exception 'أسرار الربط لا تُخزَّن في جدول الرسائل';
  end if;
end $$;


-- ==========================================================================
-- [5/11]  0094_reporting.sql
--          التقارير
-- ==========================================================================

-- ============================================================================
-- 0094 — المرحلة 14: التقارير المالية والتشغيلية والتأمينية
-- ============================================================================
--
-- **لماذا مناظير موحّدة بدل تقارير مستقلّة**
--
-- كل تقرير كُتب على حدة يحمل تعريفه الخاصّ لـ"الإيراد" و"المحصَّل"، فيخرج
-- تقرير الإيراد برقم وتقرير الذمم برقم آخر لنفس اليوم، ولا أحد يعرف أيّهما
-- الصحيح. هنا كل رقم ماليّ يُشتقّ من **مصدر واحد**: بند الفاتورة كما جمّدته
-- المرحلة 11، والضريبة كما حسبتها `app_compute_line_tax` في المرحلة 12،
-- وحصّة الشركة كما أقرّتها المرحلة 13.
--
-- كل منظور هنا يلتزم بشكل واحد ليعمل عليه مرشّح واحد في الواجهة:
--   organization_id · branch_id · تاريخ واحد باسم `report_date`
--   · معرّفات الأبعاد (doctor_id, clinic_id, item_id, company_id) وأسماؤها
--
-- كلّها `security_invoker = on`: التقرير يرى ما يراه المستخدم لا أكثر، فلا
-- يتحوّل التقرير إلى ثغرة تتخطّى عزل المنشآت والفروع.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) صلاحيات التقارير — مفصولة عن صلاحيات التشغيل
-- ===========================================================================
--
-- من يُصدر الفواتير ليس بالضرورة من يرى إيراد المنشأة كاملًا، ومن يعالج
-- المطالبات ليس بالضرورة من يرى هوامش الأطباء. لذلك صلاحية مشاهدة منفصلة
-- لكل عائلة تقارير، وصلاحية ثالثة للتصدير لأن التصدير إخراجُ بيانات.
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('reports.financial',   'التقارير المالية',   'reports', 800),
  ('reports.insurance',   'التقارير التأمينية', 'reports', 802),
  ('reports.operational', 'التقارير التشغيلية', 'reports', 804),
  ('reports.export',      'تصدير التقارير',     'reports', 806)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- التصدير إخراجُ بيانات خارج النظام، فلا يُمنح مع القراءة تلقائيًا لكل دور.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('accountant',     'reports.financial'), ('accountant', 'reports.insurance'),
  ('accountant',     'reports.operational'), ('accountant', 'reports.export'),
  ('branch_manager', 'reports.financial'), ('branch_manager', 'reports.insurance'),
  ('branch_manager', 'reports.operational'), ('branch_manager', 'reports.export'),
  ('doctor',         'reports.operational'),
  ('receptionist',   'reports.operational')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) التقارير المالية
-- ===========================================================================

-- 2-1) الإيراد بحبّة **بند الفاتورة**، لا بحبّة الفاتورة.
-- بهذا يُجمع الإيراد حسب الفرع أو الطبيب أو العيادة أو الخدمة من مصدر واحد،
-- بدل أربعة مناظير تتفرّق أرقامها. الطبيب هنا طبيب **البند** لا الفاتورة:
-- زيارة يشترك فيها طبيبان تُنسب فيها كل خدمة لمن أدّاها فعلًا.
-- `v_report_doctor_productivity` مبنيّ فوق `v_report_revenue`، فيُسقَط أولًا
-- وإلا فشل إسقاط الأصل عند إعادة تنفيذ الهجرة (dependency error).
drop view if exists v_report_doctor_productivity;
drop view if exists v_report_revenue;
create view v_report_revenue
with (security_invoker = on) as
select
  li.id                                as line_id,
  inv.id                               as invoice_id,
  inv.invoice_number,
  inv.document_number,
  inv.document_type,
  inv.status                           as invoice_status,
  inv.organization_id,
  coalesce(li.branch_id, inv.branch_id) as branch_id,
  br.name                              as branch_name,
  coalesce(inv.issued_at::date, inv.created_at::date) as report_date,
  inv.issued_at,
  coalesce(li.doctor_id, inv.doctor_id) as doctor_id,
  d.name_ar                            as doctor_name,
  inv.clinic_id,
  c.name                               as clinic_name,
  li.item_id,
  coalesce(li.item_name_snapshot, it.name_ar, li.description) as item_name,
  it.item_type,
  it.medical_service_type,
  it.category_value_id,
  cat.name_ar                          as category_name,
  inv.patient_id,
  p.name_ar                            as patient_name,
  inv.is_insurance_invoice,
  -- **اسم الشركة يُقرأ من لقطة الفاتورة**، لا من عضوية المريض الحالية:
  -- المريض قد يغيّر شركته بعد الفوترة، فيتغيّر تقرير الشهر الماضي لو أخذناه
  -- من العضوية. المعرّف يُستنتج من المطالبة إن وُجدت لأنها لقطة الوقت نفسه.
  inv.insurance_company_name,
  cf_comp.company_id                   as insurance_company_id,
  li.qty,
  li.list_price,
  li.price,
  round(li.price * li.qty, 2)          as gross_amount,
  li.discount_amount,
  li.taxable_base,
  li.vat_category,
  li.vat_rate,
  li.vat_amount,
  li.net_amount,
  li.patient_share,
  li.insurer_share,
  li.source_type,
  li.visit_id
from sales_invoice_items li
join sales_invoices inv     on inv.id = li.invoice_id
left join branches  br      on br.id  = coalesce(li.branch_id, inv.branch_id)
left join doctors   d       on d.id   = coalesce(li.doctor_id, inv.doctor_id)
left join clinics   c       on c.id   = inv.clinic_id
left join items     it      on it.id  = li.item_id
left join lookup_values cat on cat.id = it.category_value_id
left join patients  p       on p.id   = inv.patient_id
left join lateral (
  select pol.company_id
    from insurance_claim_forms f
    join patient_insurance_memberships mem on mem.id = f.membership_id
    join insurance_policies pol on pol.id = mem.policy_id
   where f.sales_invoice_id = inv.id
   order by f.created_at limit 1
) cf_comp on true
where inv.status <> 'void'
  and coalesce(inv.is_temporary, false) = false;

comment on view v_report_revenue is
  'الإيراد بحبّة بند الفاتورة: كل أبعاد التجميع (فرع/طبيب/عيادة/خدمة/شركة) في مصدر واحد، فلا تتفرّق الأرقام بين التقارير. الفواتير الملغاة والمؤقّتة مستبعَدة.';

-- 2-2) المقبوضات حسب طريقة الدفع.
-- السندات المرتجعة تظهر بإشارة سالبة في `signed_amount` ليصحّ الجمع مباشرةً،
-- وتبقى `amount` موجبةً لمن يريد عدّ الحركات.
drop view if exists v_report_receipts;
create view v_report_receipts
with (security_invoker = on) as
select
  v.id                        as voucher_id,
  v.voucher_number,
  v.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  v.voucher_date              as report_date,
  v.voucher_type,
  v.payment_method_value_id,
  pm.name_ar                  as payment_method_name,
  pm.code                     as payment_method_code,
  coalesce((pm.extra->>'affects_drawer')::boolean, false) as affects_drawer,
  v.cash_register_id,
  reg.name                    as register_name,
  v.cash_shift_id,
  v.patient_id,
  p.name_ar                   as patient_name,
  v.doctor_id,
  d.name_ar                   as doctor_name,
  v.amount,
  case when v.voucher_type in ('refund','payment') then -v.amount else v.amount end
                              as signed_amount,
  v.refund_of_voucher_id is not null as is_refund,
  v.created_by,
  v.created_at,
  v.is_void,
  alloc.sales_invoice_id,
  inv.invoice_number
from financial_vouchers v
left join lookup_values pm on pm.id = v.payment_method_value_id
left join branches      br on br.id = v.branch_id
left join cash_registers reg on reg.id = v.cash_register_id
left join patients      p  on p.id  = v.patient_id
left join doctors       d  on d.id  = v.doctor_id
left join voucher_invoice_allocations alloc on alloc.voucher_id = v.id
left join sales_invoices inv on inv.id = alloc.sales_invoice_id
where coalesce(v.is_void, false) = false;

comment on view v_report_receipts is
  'المقبوضات والمصروفات حسب طريقة الدفع والصندوق والمناوبة. `signed_amount` موقَّعة ليصحّ الجمع، والسندات الملغاة مستبعَدة.';

-- 2-3) الفواتير غير المسدَّدة مع أعمار الدين.
-- التقادم يُحسب من تاريخ **الإصدار** لا الإنشاء: مسوّدةٌ عمرها شهر ليست دينًا.
drop view if exists v_report_outstanding;
create view v_report_outstanding
with (security_invoker = on) as
select
  inv.id                      as invoice_id,
  inv.invoice_number,
  inv.document_number,
  inv.organization_id,
  inv.branch_id,
  br.name                     as branch_name,
  inv.issued_at::date         as report_date,
  inv.status,
  inv.patient_id,
  p.name_ar                   as patient_name,
  p.file_number,
  p.phone_1                   as patient_phone,
  inv.doctor_id,
  d.name_ar                   as doctor_name,
  inv.is_insurance_invoice,
  inv.insurance_company_name,
  inv.net_amount,
  inv.paid_amount,
  inv.remaining_amount,
  (current_date - inv.issued_at::date) as days_outstanding,
  case
    when inv.issued_at is null then 'غير مُصدَرة'
    when current_date - inv.issued_at::date <= 30  then '٠–٣٠'
    when current_date - inv.issued_at::date <= 60  then '٣١–٦٠'
    when current_date - inv.issued_at::date <= 90  then '٦١–٩٠'
    else 'أكثر من ٩٠'
  end                         as ageing_bucket
from sales_invoices inv
left join branches br on br.id = inv.branch_id
left join patients p  on p.id  = inv.patient_id
left join doctors  d  on d.id  = inv.doctor_id
where inv.status in ('unpaid','partial')
  and inv.remaining_amount > 0
  and coalesce(inv.is_temporary, false) = false;

comment on view v_report_outstanding is
  'الفواتير غير المسدَّدة بأعمار الدين محسوبةً من تاريخ الإصدار — المسوّدة ليست دينًا.';

-- 2-4) الخصومات والاستردادات — **بسببها ومَن أقرّها**.
-- خصمٌ بلا سبب ولا مُقرٍّ هو الباب الذي يخرج منه المال بلا أثر، ولذلك
-- يجمع هذا المنظور الاثنين في تدفّق واحد للمراجعة.
drop view if exists v_report_discounts_refunds;
create view v_report_discounts_refunds
with (security_invoker = on) as
select
  'discount'                  as entry_kind,
  inv.id                      as reference_id,
  inv.invoice_number          as reference_number,
  inv.organization_id,
  inv.branch_id,
  br.name                     as branch_name,
  coalesce(inv.issued_at::date, inv.created_at::date) as report_date,
  inv.patient_id,
  p.name_ar                   as patient_name,
  inv.doctor_id,
  d.name_ar                   as doctor_name,
  inv.discount_amount         as amount,
  inv.discount_percent        as percent_value,
  inv.discount_reason         as reason,
  inv.discount_by             as acted_by,
  u.email                     as acted_by_email
from sales_invoices inv
left join branches br on br.id = inv.branch_id
left join patients p  on p.id  = inv.patient_id
left join doctors  d  on d.id  = inv.doctor_id
left join auth.users u on u.id = inv.discount_by
where coalesce(inv.discount_amount, 0) > 0
  and inv.status <> 'void'
union all
select
  'refund',
  v.id,
  v.voucher_number,
  v.organization_id,
  v.branch_id,
  br.name,
  v.voucher_date,
  v.patient_id,
  p.name_ar,
  v.doctor_id,
  d.name_ar,
  v.amount,
  null::numeric,
  v.description,
  v.created_by,
  u.email
from financial_vouchers v
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = v.patient_id
left join doctors  d  on d.id  = v.doctor_id
left join auth.users u on u.id = v.created_by
where v.refund_of_voucher_id is not null
  and coalesce(v.is_void, false) = false
union all
select
  'void',
  inv.id,
  inv.invoice_number,
  inv.organization_id,
  inv.branch_id,
  br.name,
  coalesce(inv.voided_at::date, inv.updated_at::date),
  inv.patient_id,
  p.name_ar,
  inv.doctor_id,
  d.name_ar,
  inv.net_amount,
  null::numeric,
  inv.void_reason,
  inv.voided_by,
  u.email
from sales_invoices inv
left join branches br on br.id = inv.branch_id
left join patients p  on p.id  = inv.patient_id
left join doctors  d  on d.id  = inv.doctor_id
left join auth.users u on u.id = inv.voided_by
where inv.status = 'void';

comment on view v_report_discounts_refunds is
  'الخصومات والاستردادات والإلغاءات في تدفّق واحد بسببها ومَن أقرّها — خصمٌ بلا سبب ولا مُقرٍّ لا يظهر هنا نظيفًا.';

-- 2-5) الإشعارات الدائنة والمدينة (المرحلة 12).
drop view if exists v_report_credit_debit_notes;
create view v_report_credit_debit_notes
with (security_invoker = on) as
select
  n.id                        as note_id,
  n.document_number,
  n.document_type,
  n.note_type,
  n.note_reason,
  n.organization_id,
  n.branch_id,
  br.name                     as branch_name,
  coalesce(n.issued_at::date, n.created_at::date) as report_date,
  n.patient_id,
  p.name_ar                   as patient_name,
  n.corrects_invoice_id,
  orig.invoice_number         as corrects_invoice_number,
  orig.document_number        as corrects_document_number,
  n.subtotal_amount,
  n.vat_amount,
  n.net_amount,
  n.created_by,
  u.email                     as created_by_email
from sales_invoices n
left join sales_invoices orig on orig.id = n.corrects_invoice_id
left join branches br on br.id = n.branch_id
left join patients p  on p.id  = n.patient_id
left join auth.users u on u.id = n.created_by
where n.document_type in ('credit_note','debit_note');

comment on view v_report_credit_debit_notes is
  'الإشعارات الدائنة والمدينة مرتبطةً بالفاتورة التي تصحّحها وسببها — لا تُحذف فاتورة مُصدَرة، بل تُصحَّح بإشعار.';

-- ===========================================================================
-- 3) التقارير التأمينية
-- ===========================================================================

-- 3-1) المطالبات حسب الحالة، بمدّة المعالجة.
-- المدّة تُقاس من **الإرسال** إلى الردّ لا من الإنشاء: المطالبة التي تنتظر
-- استكمال ملفّها عندنا ليست بطئًا من الشركة.
drop view if exists v_report_claims;
create view v_report_claims
with (security_invoker = on) as
select
  cf.id                       as claim_form_id,
  cf.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  coalesce(cf.submitted_at::date, cf.created_at::date) as report_date,
  cf.created_at,
  cf.submitted_at,
  cf.responded_at,
  cf.paid_at,
  cf.status,
  cf.form_type,
  cf.nphies_status,
  cf.patient_id,
  p.name_ar                   as patient_name,
  cf.doctor_id,
  d.name_ar                   as doctor_name,
  cf.clinic_id,
  cl.name                     as clinic_name,
  pol.company_id              as insurance_company_id,
  comp.name_ar                as insurance_company_name,
  cf.claimed_amount,
  cf.approved_amount,
  cf.rejected_amount,
  cf.settled_amount,
  coalesce(cf.approved_amount, 0) - coalesce(cf.settled_amount, 0) as unsettled_amount,
  cf.resubmission_count,
  cf.rejection_code,
  cf.rejection_reason,
  case when cf.submitted_at is not null and cf.responded_at is not null
       then round(extract(epoch from (cf.responded_at - cf.submitted_at)) / 86400.0, 2)
  end                         as days_to_response,
  case when cf.submitted_at is not null and cf.paid_at is not null
       then round(extract(epoch from (cf.paid_at - cf.submitted_at)) / 86400.0, 2)
  end                         as days_to_payment,
  case when cf.submitted_at is not null and cf.responded_at is null
       then round(extract(epoch from (now() - cf.submitted_at)) / 86400.0, 2)
  end                         as days_awaiting_response
from insurance_claim_forms cf
left join patient_visits v on v.id = cf.visit_id
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = cf.patient_id
left join doctors  d  on d.id  = cf.doctor_id
left join clinics  cl on cl.id = cf.clinic_id
left join patient_insurance_memberships mem on mem.id = cf.membership_id
left join insurance_policies  pol  on pol.id  = mem.policy_id
left join insurance_companies comp on comp.id = pol.company_id;

comment on view v_report_claims is
  'المطالبات بحالتها ومبالغها ومدّة معالجتها. المدّة تُقاس من الإرسال لا من الإنشاء، فلا يُحمَّل المؤمِّن تأخيرَنا.';

-- 3-2) الرفض حسب الشركة والسبب والخدمة والطبيب — بحبّة البند.
-- الرفض على مستوى المطالبة يُخفي أن سببها بندٌ واحد متكرّر؛ هنا يظهر البند.
drop view if exists v_report_claim_rejections;
create view v_report_claim_rejections
with (security_invoker = on) as
select
  ci.id                       as claim_item_id,
  ci.form_id                  as claim_form_id,
  ci.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  coalesce(cf.responded_at::date, cf.submitted_at::date, cf.created_at::date) as report_date,
  pol.company_id              as insurance_company_id,
  comp.name_ar                as insurance_company_name,
  cf.doctor_id,
  d.name_ar                   as doctor_name,
  cf.patient_id,
  p.name_ar                   as patient_name,
  ci.item_id,
  coalesce(it.name_ar, ci.description) as item_name,
  it.medical_service_type,
  ci.service_code,
  ci.status                   as item_status,
  ci.rejection_code,
  ci.rejection_reason,
  ci.qty,
  ci.claimed_amount,
  ci.approved_amount,
  ci.rejected_amount
from insurance_claim_form_items ci
join insurance_claim_forms cf on cf.id = ci.form_id
left join patient_visits v on v.id = cf.visit_id
left join branches br on br.id = v.branch_id
left join items    it on it.id = ci.item_id
left join doctors  d  on d.id  = cf.doctor_id
left join patients p  on p.id  = cf.patient_id
left join patient_insurance_memberships mem on mem.id = cf.membership_id
left join insurance_policies  pol  on pol.id  = mem.policy_id
left join insurance_companies comp on comp.id = pol.company_id
where coalesce(ci.rejected_amount, 0) > 0
   or ci.status in ('rejected','partially_approved');

comment on view v_report_claim_rejections is
  'الرفض بحبّة البند: الشركة والسبب والكود والخدمة والطبيب — لتُعالَج الأسباب المتكرّرة بدل عدّ المطالبات المرفوضة.';

-- 3-3) الموافقات المسبقة التي قاربت الانتهاء ولم تُستهلك.
-- الموافقة المنتهية غير المستهلكة خدمةٌ أُدّيت ولن تُدفع — تُلاحَق قبل انتهائها.
drop view if exists v_report_preauth_expiring;
create view v_report_preauth_expiring
with (security_invoker = on) as
select
  pa.id                       as preauthorization_id,
  pa.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  pa.valid_to                 as report_date,
  pa.status,
  pa.approval_number,
  pa.reference_number,
  pa.patient_id,
  p.name_ar                   as patient_name,
  pa.doctor_id,
  d.name_ar                   as doctor_name,
  pa.item_id,
  coalesce(it.name_ar, pa.service_description) as item_name,
  pol.company_id              as insurance_company_id,
  comp.name_ar                as insurance_company_name,
  pa.requested_amount,
  pa.approved_amount,
  pa.qty,
  pa.valid_from,
  pa.valid_to,
  (pa.valid_to - current_date) as days_remaining,
  pa.consumed_at,
  pa.consumed_invoice_id
from insurance_preauthorizations pa
left join patient_visits v on v.id = pa.visit_id
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = pa.patient_id
left join doctors  d  on d.id  = pa.doctor_id
left join items    it on it.id = pa.item_id
left join patient_insurance_memberships mem on mem.id = pa.membership_id
left join insurance_policies  pol  on pol.id  = mem.policy_id
left join insurance_companies comp on comp.id = pol.company_id
where pa.status in ('approved','partially_approved')
  and pa.consumed_at is null
  and pa.valid_to is not null;

comment on view v_report_preauth_expiring is
  'الموافقات المعتمَدة غير المستهلكة وأيّامها المتبقّية — الموافقة التي تنتهي بلا فوترة خدمةٌ لن تُدفع.';

-- 3-4) الفارق بين حصّة التأمين المتوقَّعة والتسوية الفعلية.
-- **هذا المنظور لا يحوّل الفارق إلى المريض.** يعرضه فقط ليُراجَع بقاعدة
-- مكتوبة، كما تشترط المرحلة 13.
drop view if exists v_report_settlement_variance;
create view v_report_settlement_variance
with (security_invoker = on) as
select
  cf.id                       as claim_form_id,
  cf.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  coalesce(cf.paid_at::date, cf.responded_at::date, cf.created_at::date) as report_date,
  pol.company_id              as insurance_company_id,
  comp.name_ar                as insurance_company_name,
  cf.patient_id,
  p.name_ar                   as patient_name,
  cf.sales_invoice_id,
  inv.invoice_number,
  inv.insurance_share_amount  as expected_insurer_share,
  cf.claimed_amount,
  cf.approved_amount,
  cf.settled_amount,
  coalesce(inv.insurance_share_amount, 0) - coalesce(cf.approved_amount, 0)
                              as approval_variance,
  coalesce(cf.approved_amount, 0) - coalesce(cf.settled_amount, 0)
                              as settlement_variance,
  cf.status
from insurance_claim_forms cf
left join sales_invoices inv on inv.id = cf.sales_invoice_id
left join patient_visits v on v.id = cf.visit_id
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = cf.patient_id
left join patient_insurance_memberships mem on mem.id = cf.membership_id
left join insurance_policies  pol  on pol.id  = mem.policy_id
left join insurance_companies comp on comp.id = pol.company_id;

comment on view v_report_settlement_variance is
  'الفرق بين حصّة التأمين المتوقَّعة في الفاتورة والمعتمَد والمسدَّد. عرضٌ للمراجعة فقط — لا يُحوَّل الفرق إلى المريض من هنا.';

-- ===========================================================================
-- 4) التقارير التشغيلية
-- ===========================================================================

-- 4-1) المواعيد والوصول وعدم الحضور ووقت الانتظار.
-- الانتظار يُقاس من **الوصول الفعليّ** أو الموعد المجدول أيّهما أحدث: مريضٌ
-- حضر قبل موعده بساعة لم ينتظرنا ساعة.
drop view if exists v_report_appointments;
create view v_report_appointments
with (security_invoker = on) as
select
  a.id                        as appointment_id,
  a.organization_id,
  a.branch_id,
  br.name                     as branch_name,
  a.scheduled_start::date     as report_date,
  a.scheduled_start,
  a.scheduled_end,
  a.status,
  a.doctor_id,
  d.name_ar                   as doctor_name,
  a.clinic_id,
  c.name                      as clinic_name,
  a.patient_id,
  p.name_ar                   as patient_name,
  a.item_id,
  it.name_ar                  as item_name,
  a.no_show_reason,
  a.cancellation_reason,
  coalesce(a.checked_in_1_at, a.checked_in_2_at, a.entered_at) as arrived_at,
  a.called_at,
  a.entered_at,
  a.left_at,
  (a.status = 'no_show')      as is_no_show,
  (coalesce(a.checked_in_1_at, a.checked_in_2_at, a.entered_at) is not null) as did_arrive,
  case when a.entered_at is not null
        and coalesce(a.checked_in_1_at, a.checked_in_2_at) is not null
       then round(extract(epoch from (a.entered_at
              - greatest(coalesce(a.checked_in_1_at, a.checked_in_2_at), a.scheduled_start)
            )) / 60.0, 1)
  end                         as wait_minutes,
  case when a.entered_at is not null and a.left_at is not null
       then round(extract(epoch from (a.left_at - a.entered_at)) / 60.0, 1)
  end                         as consultation_minutes,
  v.id                        as visit_id,
  v.status                    as visit_status,
  case when v.started_at is not null and v.ended_at is not null
       then round(extract(epoch from (v.ended_at - v.started_at)) / 60.0, 1)
  end                         as visit_minutes
from appointments a
left join branches br on br.id = a.branch_id
left join doctors  d  on d.id  = a.doctor_id
left join clinics  c  on c.id  = a.clinic_id
left join patients p  on p.id  = a.patient_id
left join items    it on it.id = a.item_id
left join patient_visits v on v.appointment_id = a.id;

comment on view v_report_appointments is
  'المواعيد والوصول وعدم الحضور ووقت الانتظار ومدّة الزيارة. الانتظار يُقاس من الوصول أو الموعد أيّهما أحدث، فلا يُحسب حضورُ المريض المبكّر انتظارًا علينا.';

-- 4-2) إنتاجية الأطباء: زيارات وخدمات وإيراد ليومٍ وطبيب.
-- الإيراد هنا **إيراد البند المنسوب للطبيب**، لا إيراد الفاتورة كاملًا،
-- وإلا نُسب عمل المختبر إلى طبيب العيادة.
drop view if exists v_report_doctor_productivity;
create view v_report_doctor_productivity
with (security_invoker = on) as
with visits as (
  select v.organization_id, v.branch_id, v.doctor_id, v.visit_date::date as report_date,
         count(*) as visit_count,
         count(*) filter (where v.status in ('signed','closed')) as completed_visits,
         avg(case when v.started_at is not null and v.ended_at is not null
                  then extract(epoch from (v.ended_at - v.started_at)) / 60.0 end)
           as avg_visit_minutes
  from patient_visits v
  where v.status <> 'cancelled'
  group by 1,2,3,4
),
revenue as (
  select r.organization_id, r.branch_id, r.doctor_id, r.report_date,
         count(*)                as line_count,
         sum(r.qty)              as service_qty,
         sum(r.net_amount)       as net_revenue,
         sum(r.patient_share)    as patient_share,
         sum(r.insurer_share)    as insurer_share
  from v_report_revenue r
  group by 1,2,3,4
)
select
  coalesce(vs.organization_id, rv.organization_id) as organization_id,
  coalesce(vs.branch_id, rv.branch_id)             as branch_id,
  br.name                                          as branch_name,
  coalesce(vs.doctor_id, rv.doctor_id)             as doctor_id,
  d.name_ar                                        as doctor_name,
  coalesce(vs.report_date, rv.report_date)         as report_date,
  coalesce(vs.visit_count, 0)                      as visit_count,
  coalesce(vs.completed_visits, 0)                 as completed_visits,
  round(vs.avg_visit_minutes::numeric, 1)          as avg_visit_minutes,
  coalesce(rv.line_count, 0)                       as line_count,
  coalesce(rv.service_qty, 0)                      as service_qty,
  coalesce(rv.net_revenue, 0)                      as net_revenue,
  coalesce(rv.patient_share, 0)                    as patient_share,
  coalesce(rv.insurer_share, 0)                    as insurer_share
from visits vs
full outer join revenue rv
  on rv.organization_id = vs.organization_id
 and rv.doctor_id is not distinct from vs.doctor_id
 and rv.branch_id is not distinct from vs.branch_id
 and rv.report_date = vs.report_date
left join branches br on br.id = coalesce(vs.branch_id, rv.branch_id)
left join doctors  d  on d.id  = coalesce(vs.doctor_id, rv.doctor_id);

comment on view v_report_doctor_productivity is
  'إنتاجية الطبيب يوميًّا: زيارات ومدّتها وخدمات وإيراد منسوب لبنوده هو — لا لإيراد الفاتورة كاملةً.';

-- 4-3) الطلبات (مختبر وأشعة وخدمات) في تدفّق واحد بمدّة الإنجاز.
drop view if exists v_report_orders;
create view v_report_orders
with (security_invoker = on) as
select
  'lab'                       as order_kind,
  lo.id                       as order_id,
  lo.organization_id,
  lo.branch_id,
  br.name                     as branch_name,
  lo.ordered_at::date         as report_date,
  lo.ordered_at,
  lo.resulted_at              as finished_at,
  lo.status,
  lo.priority,
  lo.patient_id,
  p.name_ar                   as patient_name,
  lo.ordering_doctor_id       as doctor_id,
  d.name_ar                   as doctor_name,
  lo.clinic_id,
  c.name                      as clinic_name,
  lo.visit_id,
  lo.sales_invoice_id,
  case when lo.resulted_at is not null
       then round(extract(epoch from (lo.resulted_at - lo.ordered_at)) / 3600.0, 2)
  end                         as turnaround_hours
from lab_orders lo
left join branches br on br.id = lo.branch_id
left join patients p  on p.id  = lo.patient_id
left join doctors  d  on d.id  = lo.ordering_doctor_id
left join clinics  c  on c.id  = lo.clinic_id
union all
select
  'radiology',
  ro.id,
  ro.organization_id,
  ro.branch_id,
  br.name,
  ro.ordered_at::date,
  ro.ordered_at,
  ro.reported_at,
  ro.status,
  ro.priority,
  ro.patient_id,
  p.name_ar,
  ro.ordering_doctor_id,
  d.name_ar,
  ro.clinic_id,
  c.name,
  ro.visit_id,
  ro.sales_invoice_id,
  case when ro.reported_at is not null
       then round(extract(epoch from (ro.reported_at - ro.ordered_at)) / 3600.0, 2)
  end
from radiology_orders ro
left join branches br on br.id = ro.branch_id
left join patients p  on p.id  = ro.patient_id
left join doctors  d  on d.id  = ro.ordering_doctor_id
left join clinics  c  on c.id  = ro.clinic_id
union all
select
  'service',
  s.id,
  s.organization_id,
  v.branch_id,
  br.name,
  s.created_at::date,
  s.created_at,
  s.status_changed_at,
  s.status,
  null,
  v.patient_id,
  p.name_ar,
  coalesce(s.performed_by, v.doctor_id),
  d.name_ar,
  v.clinic_id,
  c.name,
  s.visit_id,
  null::uuid,
  case when s.status_changed_at is not null
       then round(extract(epoch from (s.status_changed_at - s.created_at)) / 3600.0, 2)
  end
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
left join branches br on br.id = v.branch_id
left join patients p  on p.id  = v.patient_id
left join doctors  d  on d.id  = coalesce(s.performed_by, v.doctor_id)
left join clinics  c  on c.id  = v.clinic_id;

comment on view v_report_orders is
  'الطلبات الطبّية كلّها (مختبر/أشعة/خدمات) في تدفّق واحد بمدّة الإنجاز بالساعات.';

-- 4-4) صرف الأدوية.
drop view if exists v_report_dispensing;
create view v_report_dispensing
with (security_invoker = on) as
select
  di.id                       as dispensing_item_id,
  dr.id                       as dispensing_record_id,
  di.organization_id,
  v.branch_id,
  br.name                     as branch_name,
  coalesce(dr.dispensed_at::date, dr.created_at::date) as report_date,
  dr.dispensed_at,
  dr.status,
  dr.patient_id,
  p.name_ar                   as patient_name,
  dr.pharmacist_id,
  dr.warehouse_id,
  w.name                      as warehouse_name,
  di.drug_item_id             as item_id,
  it.name_ar                  as item_name,
  di.lot_id,
  lot.lot_number,
  lot.expiry_date,
  di.quantity_dispensed       as qty,
  di.unit_price,
  round(coalesce(di.unit_price, 0) * coalesce(di.quantity_dispensed, 0), 2) as value_amount,
  dr.prescription_id,
  pr.doctor_id,
  d.name_ar                   as doctor_name,
  dr.sales_invoice_id
from dispensing_items di
join dispensing_records dr on dr.id = di.dispensing_record_id
left join prescriptions pr on pr.id = dr.prescription_id
left join patient_visits v on v.id = pr.visit_id
left join branches   br  on br.id  = v.branch_id
left join patients   p   on p.id   = dr.patient_id
left join warehouses w   on w.id   = dr.warehouse_id
left join items      it  on it.id  = di.drug_item_id
left join inventory_lots lot on lot.id = di.lot_id
left join doctors    d   on d.id   = pr.doctor_id;

comment on view v_report_dispensing is
  'صرف الأدوية بحبّة البند: الدواء والتشغيلة وتاريخ صلاحيتها والكمّية والقيمة والصيدليّ والطبيب الواصف.';

-- 4-5) حركة المخزون.
drop view if exists v_report_stock_movements;
create view v_report_stock_movements
with (security_invoker = on) as
select
  m.id                        as movement_id,
  m.organization_id,
  w.branch_id,
  br.name                     as branch_name,
  m.created_at::date          as report_date,
  m.created_at,
  m.movement_type,
  m.warehouse_id,
  w.name                      as warehouse_name,
  m.item_id,
  it.name_ar                  as item_name,
  it.item_type,
  m.lot_id,
  lot.lot_number,
  lot.expiry_date,
  m.qty,
  m.unit_price,
  m.total_amount,
  m.patient_id,
  p.name_ar                   as patient_name,
  m.doctor_id,
  d.name_ar                   as doctor_name,
  m.related_sales_invoice_id,
  m.related_purchase_invoice_id,
  m.related_stock_transfer_id,
  m.note,
  m.created_by
from inventory_movements m
left join warehouses w on w.id = m.warehouse_id
left join branches   br on br.id = w.branch_id
left join items      it on it.id = m.item_id
left join inventory_lots lot on lot.id = m.lot_id
left join patients   p  on p.id  = m.patient_id
left join doctors    d  on d.id  = m.doctor_id;

comment on view v_report_stock_movements is
  'حركة المخزون بنوعها وتشغيلتها وقيمتها ومرجعها (فاتورة بيع أو شراء أو تحويل).';

-- 4-6) رحلة المريض من الموعد حتى التحصيل — قمع تشغيليّ.
-- كل صفّ موعدٌ واحد، وأعمدته مراحله. الفجوة بين عمودين متجاورين هي المكان
-- الذي يتسرّب منه المال أو المريض.
drop view if exists v_report_patient_funnel;
create view v_report_patient_funnel
with (security_invoker = on) as
select
  a.id                        as appointment_id,
  a.organization_id,
  a.branch_id,
  br.name                     as branch_name,
  a.scheduled_start::date     as report_date,
  a.patient_id,
  p.name_ar                   as patient_name,
  a.doctor_id,
  d.name_ar                   as doctor_name,
  a.clinic_id,
  c.name                      as clinic_name,
  a.status                    as appointment_status,
  (coalesce(a.checked_in_1_at, a.checked_in_2_at, a.entered_at) is not null) as reached_reception,
  v.id                        as visit_id,
  (v.id is not null)          as reached_visit,
  v.status                    as visit_status,
  (v.status in ('signed','closed')) as visit_signed,
  inv.id                      as invoice_id,
  (inv.id is not null)        as reached_invoice,
  inv.status                  as invoice_status,
  inv.net_amount,
  inv.paid_amount,
  inv.remaining_amount,
  (coalesce(inv.paid_amount, 0) > 0) as reached_payment,
  (inv.status = 'paid')       as fully_collected,
  cf.id                       as claim_form_id,
  cf.status                   as claim_status
from appointments a
left join branches br on br.id = a.branch_id
left join patients p  on p.id  = a.patient_id
left join doctors  d  on d.id  = a.doctor_id
left join clinics  c  on c.id  = a.clinic_id
left join patient_visits v on v.appointment_id = a.id
left join lateral (
  select i.* from sales_invoices i
   where i.visit_id = v.id and i.status <> 'void'
   order by i.created_at limit 1
) inv on true
left join lateral (
  select f.* from insurance_claim_forms f
   where f.visit_id = v.id
   order by f.created_at desc limit 1
) cf on true;

comment on view v_report_patient_funnel is
  'قمع رحلة المريض: موعد ← استقبال ← زيارة ← توقيع ← فاتورة ← تحصيل ← مطالبة. الفجوة بين مرحلتين متجاورتين هي موضع التسرّب.';

-- ===========================================================================
-- 5) الأذونات
-- ===========================================================================
grant select on
  v_report_revenue, v_report_receipts, v_report_outstanding,
  v_report_discounts_refunds, v_report_credit_debit_notes,
  v_report_claims, v_report_claim_rejections, v_report_preauth_expiring,
  v_report_settlement_variance,
  v_report_appointments, v_report_doctor_productivity, v_report_orders,
  v_report_dispensing, v_report_stock_movements, v_report_patient_funnel
to authenticated;

-- ===========================================================================
-- 6) فحص ذاتي
-- ===========================================================================
do $$
declare
  v_missing text[] := '{}';
  v_v text;
  v_no_invoker text[] := '{}';
begin
  foreach v_v in array array[
    'v_report_revenue','v_report_receipts','v_report_outstanding',
    'v_report_discounts_refunds','v_report_credit_debit_notes',
    'v_report_claims','v_report_claim_rejections','v_report_preauth_expiring',
    'v_report_settlement_variance','v_report_appointments',
    'v_report_doctor_productivity','v_report_orders','v_report_dispensing',
    'v_report_stock_movements','v_report_patient_funnel']
  loop
    if not exists (select 1 from information_schema.views
                    where table_schema = 'public' and table_name = v_v) then
      v_missing := v_missing || v_v;
      continue;
    end if;
    -- **التقرير لا يجوز أن يتخطّى العزل**: منظور بلا security_invoker يعرض
    -- بيانات المنشآت الأخرى لمن يملك حقّ القراءة على المنظور وحده.
    if not exists (
      select 1 from pg_class cl
       join pg_namespace n on n.oid = cl.relnamespace
       where n.nspname = 'public' and cl.relname = v_v
         and cl.reloptions::text like '%security_invoker=on%') then
      v_no_invoker := v_no_invoker || v_v;
    end if;
    -- كل تقرير يجب أن يحمل أعمدة المرشّح الموحّد
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_v
                      and column_name = 'organization_id') then
      raise exception 'المنظور % بلا organization_id — لا يمكن عزله', v_v;
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_v
                      and column_name = 'report_date') then
      raise exception 'المنظور % بلا report_date — لا يمكن ترشيحه بنطاق تاريخ', v_v;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'مناظير تقارير ناقصة: %', array_to_string(v_missing, ', ');
  end if;
  if array_length(v_no_invoker, 1) > 0 then
    raise exception 'مناظير تقارير بلا security_invoker: %', array_to_string(v_no_invoker, ', ');
  end if;

  if not exists (select 1 from permission_catalog
                  where permission_key = 'reports.financial') then
    raise exception 'صلاحية التقارير المالية غير مضافة';
  end if;
end $$;


-- ==========================================================================
-- [6/11]  0095_security_audit_pdpl.sql
--          الأمن والتدقيق وحماية البيانات
-- ==========================================================================

-- ============================================================================
-- 0095 — المرحلة 15: الأمان والتدقيق وحماية البيانات الشخصية (PDPL)
-- ============================================================================
--
-- هذه المرحلة لا تضيف ميزةً يراها المستخدم، بل تُغلق ما يُفتح بلا قصد:
-- دالّةٌ جديدة تُنشأ فتصير قابلة للاستدعاء من `anon`، ومنظورٌ يُكتب بلا
-- `security_invoker` فيتخطّى عزل المنشآت، وسجلٌّ طبيّ يُقرأ بلا أثر.
--
-- **المبدأ الحاكم**: الفحص لا يكفي مرّةً واحدة. كل فحص هنا يُثبَّت في
-- `v_security_advisor` ليُعاد تشغيله بعد كل هجرة قادمة، وما أمكن تثبيته
-- بمُحفِّز حدثٍ (event trigger) يُغلق تلقائيًّا بلا انتظار مراجعة بشرية.
--
-- **لا حذف نهائيًّا** لبيانات طبية أو مالية: سياسات الاحتفاظ هنا تُؤرشِف
-- أو تُخفي الهوية، ولا تحذف صفًّا واحدًا.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) صلاحيات الأمان والخصوصية
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('insurance.submit',        'إرسال المطالبات',            'insurance', 620),
  ('insurance.settle',        'تسوية مدفوعات التأمين',      'insurance', 622),
  ('audit.view',              'عرض سجل التدقيق',            'security',  900),
  ('audit.access_log',        'عرض سجل الوصول للملف الطبي', 'security',  902),
  ('patients.view_medical',   'عرض المحتوى الطبي',          'security',  904),
  ('patients.view_financial', 'عرض بيانات المريض المالية',  'security',  906),
  ('patients.view_identity',  'عرض الهوية وبيانات التواصل', 'security',  908),
  ('privacy.consents',        'إدارة موافقات المريض',       'security',  910),
  ('privacy.retention',       'إدارة سياسات الاحتفاظ',      'security',  912)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('doctor',         'patients.view_medical'), ('doctor', 'patients.view_identity'),
  ('nurse',          'patients.view_medical'), ('nurse',  'patients.view_identity'),
  ('receptionist',   'patients.view_identity'),
  ('accountant',     'patients.view_financial'),
  ('accountant',     'insurance.submit'), ('accountant', 'insurance.settle'),
  ('branch_manager', 'patients.view_medical'), ('branch_manager', 'patients.view_identity'),
  ('branch_manager', 'patients.view_financial'), ('branch_manager', 'audit.view'),
  ('branch_manager', 'insurance.submit'), ('branch_manager', 'insurance.settle'),
  ('branch_manager', 'privacy.consents')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) إغلاق `anon` على دوال SECURITY DEFINER — وإبقاؤه مغلقًا
-- ===========================================================================
--
-- دالّة `SECURITY DEFINER` تعمل بصلاحيات مالكها فتتخطّى RLS بحكم تعريفها.
-- إن بقي حقّ تنفيذها ممنوحًا لـ `public` (وهو الافتراضي في PostgreSQL)
-- صار بإمكان زائرٍ غير مسجَّل استدعاءها. الحاجز الوحيد اليوم هو أن
-- `app_has_permission` ترفض `auth.uid()` الفارغة — وهذا حاجزٌ في المنطق،
-- والمطلوب حاجزٌ في الصلاحيات.
-- الجرد الشامل يُنفَّذ في القسم 9.5 **بعد** إنشاء دوال هذه الهجرة نفسها.
-- لو نُفِّذ هنا لبقيت دوالّ الأقسام التالية مفتوحةً في أي بيئة لا يُركَّب فيها
-- مُحفِّز الأحداث — وهو ما يحدث فعلًا في Supabase المُدارة.

-- إغلاق دائم: كل دالّة `SECURITY DEFINER` تُنشأ لاحقًا تُغلق فور إنشائها،
-- فلا تعتمد السلامة على تذكُّر المبرمج في كل هجرة.
--
-- مُحفِّزات الأحداث تحتاج صلاحيةً عالية؛ إن لم تتوفّر في البيئة نكتفي
-- بالفحص في `v_security_advisor` ولا نُفشل الهجرة.
create or replace function app_guard_definer_grants()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
  loop
    if obj.object_type = 'function' then
      if exists (select 1 from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                 where p.oid = obj.objid and n.nspname = 'public' and p.prosecdef) then
        execute format('revoke all on function %s from public', obj.objid::regprocedure);
        execute format('revoke all on function %s from anon', obj.objid::regprocedure);
        execute format('grant execute on function %s to authenticated', obj.objid::regprocedure);
      end if;
    end if;
  end loop;
end $$;

do $$
begin
  begin
    drop event trigger if exists trg_guard_definer_grants;
    create event trigger trg_guard_definer_grants
      on ddl_command_end
      when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
      execute function app_guard_definer_grants();
  exception when insufficient_privilege or others then
    raise notice 'تعذّر تركيب مُحفِّز الأحداث (%). الفحص يبقى في v_security_advisor.', sqlerrm;
  end;
end $$;

-- ===========================================================================
-- 3) سجل التدقيق: الفرع، ولقطة القيم، وسبب الإجراء
-- ===========================================================================

alter table audit_log
  add column if not exists branch_id uuid references branches(id);

comment on column audit_log.branch_id is
  'فرع الحدث حين يكون السجلّ تابعًا لفرع — يُملأ تلقائيًّا من الصف المُدقَّق.';

create index if not exists idx_audit_log_branch
  on audit_log (organization_id, branch_id, occurred_at desc);

-- `app_audit_log_auto` يلتقط القيم قبل وبعد والوقت والمنشأة والمستخدم، وينقصه
-- الفرع.
--
-- كانت هذه الكتلة سابقًا **ترقّع نصّ الدالّة المخزَّن في القاعدة** بـ`replace`
-- على أسطر بعينها. وهذا خطأ في التصميم: النصّ المخزَّن يختلف من قاعدة إلى أخرى
-- بحسب آخر هجرة عُدّلت فيها الدالّة، فأيّ فرق في مسافة بادئة يُسقط الترقيع
-- ويوقف الهجرة كلّها برسالة «تغيّر نصّ الدالّة» — وهو ما وقع فعلًا على قاعدة
-- إنتاجية. الآن تُكتب الدالّة كاملةً وصراحةً: النتيجة واحدة مهما كانت النسخة
-- المخزَّنة، ولا شيء يعتمد على تنسيق نصّ سابق.
--
-- المنطق أدناه منقول حرفيًّا من 0048 (آخر نسخة معتمدة) مع إضافة الفرع وحده:
-- تخطّي حذف المنشأة، واستثناء أعمدة jsonb/المصفوفات من المقارنة (فكّ الضغط
-- كان يرفع زمن التعديل من 2.4ms إلى 1020ms)، وتجاهل التعديل الذي لا يغيّر شيئًا.
create or replace function app_audit_log_auto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec       record;
  v_title     text;
  v_action    text;
  v_details   jsonb;
  v_org       uuid;
  v_entity    uuid;
  v_diff_sql  text;
  v_branch    uuid;
begin
  v_rec := case when TG_OP = 'DELETE' then OLD else NEW end;

  execute format('select ($1).organization_id, ($1).id%s',
                 case when TG_NARGS > 0 then format(', ($1).%I::text', TG_ARGV[0]) else ', null::text' end)
    into v_org, v_entity, v_title
    using v_rec;

  -- الفرع اختياري: كثير من الجداول المُدقَّقة بلا عمود فرع، فالفشل هنا متوقَّع
  -- ولا يجوز أن يُسقط التعديل نفسه.
  begin
    execute 'select ($1).branch_id' into v_branch using v_rec;
  exception when others then
    v_branch := null;
  end;

  -- حذف المنشأة نفسها: `audit_log.organization_id` مفتاح أجنبي على
  -- `organizations` بـ `on delete cascade` (0001). أثناء الحذف المتتالي يُحذف
  -- صف المنشأة أولًا ثم أبناؤها، فيحاول هذا المُحفِّز إدراج صف تدقيق يشير إلى
  -- منشأة لم تعد موجودة — فيفشل الحذف كله بخطأ مفتاح أجنبي.
  if TG_OP = 'DELETE' and not exists (select 1 from organizations o where o.id = v_org) then
    return OLD;
  end if;

  v_action := case TG_OP when 'INSERT' then 'add' when 'UPDATE' then 'update' when 'DELETE' then 'delete' end;

  if TG_OP = 'UPDATE' then
    select string_agg(
             format($f$case when ($1).%1$I is distinct from ($2).%1$I
                       then jsonb_build_object(%2$L, jsonb_build_object(
                              'old', to_jsonb(left(($1).%1$I::text, 500)),
                              'new', to_jsonb(left(($2).%1$I::text, 500))))
                       else '{}'::jsonb end$f$, a.attname, a.attname), ' || ')
      into v_diff_sql
      from pg_attribute a
     where a.attrelid = TG_RELID
       and a.attnum > 0
       and not a.attisdropped
       -- `updated_at` يتغيّر في كل تعديل فيصبح ضجيجًا في كل سطر
       and a.attname <> 'updated_at'
       -- أعمدة jsonb/json والمصفوفات تُستثنى من المقارنة (انظر أعلاه).
       and a.atttypid not in ('jsonb'::regtype, 'json'::regtype)
       and a.attndims = 0;

    if v_diff_sql is not null then
      execute 'select ' || v_diff_sql into v_details using OLD, NEW;
      if v_details = '{}'::jsonb then v_details := null; end if;
    end if;

    -- تعديل لم يغيّر شيئًا لا يُسجَّل: مُحفِّزات قائمة تُصدر تحديثات بلا تغيير
    -- (`else status`, أو ضبط `updated_at` وحده) فكانت تدفن التعديل الحقيقي.
    if v_details is null then
      return NEW;
    end if;
  end if;

  insert into audit_log (branch_id, organization_id, user_id, action_type, module,
                         entity_id, entity_title, details, device_name)
  values (
    v_branch,
    v_org,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_entity,
    v_title,
    -- `audit_log.details` من نوع text لا jsonb (0001) — التحويل صريح حتى لا
    -- يعتمد الإدراج على تحويل ضمني قد يختلف سلوكه بين إصدارات PostgreSQL.
    v_details::text,
    app_request_device_name()
  );

  return coalesce(NEW, OLD);
end;
$$;

-- تحقّق فوريّ: الفرع صار في قائمة الأعمدة وفي قائمة القيم معًا. لو اختلّ
-- التوافق لفشل أوّل تعديل في النظام بخطأٍ لا علاقة له ظاهريًّا بالتدقيق.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'app_audit_log_auto'
         and pg_get_functiondef(p.oid) like '%branch_id, organization_id%'
         and pg_get_functiondef(p.oid) like '%v_branch,%') <> 1 then
    raise exception 'دالّة التدقيق لم تُكتب بالفرع — راجع 0095';
  end if;
end $$;

-- ===========================================================================
-- 4) سجل الوصول إلى الملف الطبي
-- ===========================================================================
--
-- PDPL تسأل «مَن اطّلع؟» لا «مَن عدّل؟». سجل التدقيق يجيب عن الثانية فقط،
-- لأن القراءة لا تُطلق مُحفِّزًا. لذلك تُسجَّل القراءة صراحةً من الواجهة
-- عند فتح ملفٍ طبيّ.
create table if not exists medical_record_access_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  patient_id      uuid not null references patients(id),
  user_id         uuid references auth.users(id),
  access_type     text not null default 'view'
                    check (access_type in ('view','print','export','download','search')),
  context         text,
  reason          text,
  visit_id        uuid references patient_visits(id),
  document_id     uuid,
  occurred_at     timestamptz not null default now()
);

comment on table medical_record_access_log is
  'سجل الاطّلاع على الملف الطبي. القراءة لا تُطلق مُحفِّزًا، فتُسجَّل صراحةً — وهذا ما تسأل عنه PDPL.';

create index if not exists idx_mral_patient
  on medical_record_access_log (organization_id, patient_id, occurred_at desc);
create index if not exists idx_mral_user
  on medical_record_access_log (organization_id, user_id, occurred_at desc);

alter table medical_record_access_log enable row level security;

create or replace function app_log_record_access(
  p_patient_id  uuid,
  p_access_type text default 'view',
  p_context     text default null,
  p_reason      text default null,
  p_visit_id    uuid default null
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
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null then raise exception 'المريض غير موجود'; end if;
  if not app_is_member(v_org) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;

  select v.branch_id into v_branch
    from patient_visits v where v.id = p_visit_id;

  insert into medical_record_access_log (organization_id, branch_id, patient_id,
                                         user_id, access_type, context, reason, visit_id)
  values (v_org, v_branch, p_patient_id, auth.uid(),
          coalesce(p_access_type, 'view'), p_context, p_reason, p_visit_id)
  returning id into v_id;

  return v_id;
end $$;

-- ===========================================================================
-- 5) موافقات المريض — بغرضها ونسختها وسحبها
-- ===========================================================================
--
-- `patient_documents.is_consent` يحفظ **الورقة**، لا **الحالة**: لا يقول
-- هل الموافقة سارية اليوم، ولا لأي غرض، ولا متى سُحبت. وPDPL تشترط الغرض
-- وإمكان السحب. الجدول هنا يحفظ الحالة، والمستند يبقى دليلها.
create table if not exists patient_consents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  patient_id       uuid not null references patients(id),
  consent_type     text not null
                     check (consent_type in ('treatment','data_processing','data_sharing',
                                             'marketing','photography','research','telehealth')),
  purpose          text not null,
  status           text not null default 'granted'
                     check (status in ('granted','withdrawn','expired','superseded')),
  version          integer not null default 1,
  granted_at       timestamptz not null default now(),
  granted_by       uuid references auth.users(id),
  expires_at       timestamptz,
  withdrawn_at     timestamptz,
  withdrawn_by     uuid references auth.users(id),
  withdrawal_reason text,
  document_id      uuid references patient_documents(id),
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table patient_consents is
  'موافقات المريض بحالتها وغرضها ونسختها. **لا تُحذف موافقة مسحوبة** — تبقى شاهدًا على أن السحب حدث ومتى.';

-- موافقة سارية واحدة لكل غرض: بلا هذا تتراكم موافقات متناقضة ولا يُعرف
-- أيّها المعمول به.
create unique index if not exists uq_active_consent
  on patient_consents (patient_id, consent_type)
  where status = 'granted';

create index if not exists idx_consents_patient
  on patient_consents (organization_id, patient_id, consent_type);

alter table patient_consents enable row level security;

create or replace function app_record_patient_consent(
  p_patient_id   uuid,
  p_consent_type text,
  p_purpose      text,
  p_expires_at   timestamptz default null,
  p_document_id  uuid default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_id      uuid;
  v_version integer;
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null then raise exception 'المريض غير موجود'; end if;
  if not app_has_permission(v_org, 'privacy.consents') then
    raise exception 'صلاحيتك لا تسمح بتسجيل الموافقات (privacy.consents)';
  end if;
  if coalesce(trim(p_purpose), '') = '' then
    raise exception 'الغرض من الموافقة مطلوب — موافقةٌ بلا غرض لا تصلح سندًا';
  end if;

  -- الموافقة السابقة تُصبح «مستبدَلة» ولا تُحذف
  select coalesce(max(version), 0) + 1 into v_version
    from patient_consents
   where patient_id = p_patient_id and consent_type = p_consent_type;

  update patient_consents
     set status = 'superseded', updated_at = now()
   where patient_id = p_patient_id and consent_type = p_consent_type
     and status = 'granted';

  insert into patient_consents (organization_id, patient_id, consent_type, purpose,
                                version, granted_by, expires_at, document_id, note)
  values (v_org, p_patient_id, p_consent_type, p_purpose,
          v_version, auth.uid(), p_expires_at, p_document_id, p_note)
  returning id into v_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_org, auth.uid(), 'privacy', 'add', v_id, 'موافقة مريض',
          format('موافقة %s نسخة %s', p_consent_type, v_version), p_purpose);

  return v_id;
end $$;

create or replace function app_withdraw_patient_consent(
  p_consent_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c patient_consents%rowtype;
begin
  select * into v_c from patient_consents where id = p_consent_id for update;
  if v_c.id is null then raise exception 'الموافقة غير موجودة'; end if;
  if not app_has_permission(v_c.organization_id, 'privacy.consents') then
    raise exception 'صلاحيتك لا تسمح بسحب الموافقات (privacy.consents)';
  end if;
  if v_c.status <> 'granted' then
    raise exception 'الموافقة ليست سارية (حالتها %)', v_c.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب السحب مطلوب';
  end if;

  update patient_consents
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(),
         withdrawal_reason = p_reason, updated_at = now()
   where id = p_consent_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_c.organization_id, auth.uid(), 'privacy', 'update', p_consent_id,
          'سحب موافقة', format('سُحبت موافقة %s', v_c.consent_type), p_reason);
end $$;

-- الموافقة السارية فعلًا: غير منتهية وغير مسحوبة
create or replace function app_has_patient_consent(
  p_patient_id   uuid,
  p_consent_type text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from patient_consents
     where patient_id = p_patient_id
       and consent_type = p_consent_type
       and status = 'granted'
       and (expires_at is null or expires_at > now()));
$$;

-- ===========================================================================
-- 6) سياسات الاحتفاظ والأرشفة — بلا حذف
-- ===========================================================================
create table if not exists data_retention_policies (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  entity_key       text not null
                     check (entity_key in ('patient_records','appointments','audit_log',
                                           'access_log','documents','messages','invoices')),
  retention_months integer not null check (retention_months >= 1),
  action_on_expiry text not null default 'archive'
                     check (action_on_expiry in ('archive','anonymize','review')),
  legal_basis      text not null,
  is_active        boolean not null default true,
  last_run_at      timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id)
);

comment on table data_retention_policies is
  'سياسات الاحتفاظ. `action_on_expiry` لا يتضمّن الحذف: البيانات الطبية والمالية تُؤرشَف أو تُخفى هويّتها، ولا تُمحى.';

-- سياسة واحدة سارية لكل نوع بيانات في المنشأة
create unique index if not exists uq_retention_entity
  on data_retention_policies (organization_id, entity_key)
  where is_active;

alter table data_retention_policies enable row level security;

-- **حارس صريح**: لو أُضيف يومًا خيارُ حذفٍ إلى القائمة، يفشل الإدراج هنا
-- بدل أن يمرّ صامتًا.
create or replace function app_guard_retention_action()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.action_on_expiry in ('delete','purge','erase') then
    raise exception 'الحذف النهائي غير مسموح لسياسات الاحتفاظ — استخدم الأرشفة أو إخفاء الهوية';
  end if;
  if coalesce(trim(new.legal_basis), '') = '' then
    raise exception 'السند النظامي للاحتفاظ مطلوب';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- تقدير أثر السياسة قبل تطبيقها — **إحصاء لا تعديل**.
--
-- الأرشفة الفعلية تختلف بين نوع بيانات وآخر (الملف الطبي يُؤرشَف، والموعد
-- يُخفى صاحبه، والفاتورة لا تُمَسّ)، فتُنفَّذ كلٌّ في مرحلتها. ما يلزم اليوم
-- هو أن يرى المشغّل **حجم ما تجاوز المدّة** قبل أن يقرّر، وأن يُختم وقت آخر
-- مراجعة. هذه الدالّة لا تحذف ولا تعدّل صفًّا واحدًا من البيانات.
create or replace function app_apply_retention_policy(p_policy_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p      data_retention_policies%rowtype;
  v_cutoff timestamptz;
  v_count  integer := 0;
begin
  select * into v_p from data_retention_policies where id = p_policy_id for update;
  if v_p.id is null then raise exception 'السياسة غير موجودة'; end if;
  if not app_has_permission(v_p.organization_id, 'privacy.retention') then
    raise exception 'صلاحيتك لا تسمح بتشغيل سياسات الاحتفاظ (privacy.retention)';
  end if;

  v_cutoff := now() - make_interval(months => v_p.retention_months);

  v_count := case v_p.entity_key
    when 'patient_records' then
      (select count(*) from patient_visits
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    when 'appointments' then
      (select count(*) from appointments
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    when 'audit_log' then
      (select count(*) from audit_log
        where organization_id = v_p.organization_id and occurred_at < v_cutoff)
    when 'access_log' then
      (select count(*) from medical_record_access_log
        where organization_id = v_p.organization_id and occurred_at < v_cutoff)
    when 'documents' then
      (select count(*) from patient_documents
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    when 'messages' then
      (select count(*) from internal_messages
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    when 'invoices' then
      (select count(*) from sales_invoices
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    else 0
  end;

  update data_retention_policies
     set last_run_at = now(), updated_at = now(), updated_by = auth.uid()
   where id = p_policy_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_p.organization_id, auth.uid(), 'privacy', 'update', p_policy_id,
          'مراجعة سياسة احتفاظ',
          format('%s سجلًّا تجاوز %s شهرًا (إجراء: %s)',
                 v_count, v_p.retention_months, v_p.action_on_expiry),
          v_p.legal_basis);

  return v_count;
end $$;

drop trigger if exists trg_guard_retention_action on data_retention_policies;
create trigger trg_guard_retention_action
  before insert or update on data_retention_policies
  for each row execute function app_guard_retention_action();

-- ===========================================================================
-- 7) إخفاء البيانات حسب الدور
-- ===========================================================================
--
-- الإخفاء يقع في **القاعدة** لا في الواجهة: واجهةٌ تُخفي حقلًا وتُنزّله في
-- الاستجابة لم تُخفِ شيئًا — من يفتح أدوات المطوّر يقرؤه.
create or replace function app_mask_text(p_value text, p_keep integer default 4)
returns text
language sql
immutable
as $$
  select case
    when p_value is null or length(p_value) = 0 then null
    when length(p_value) <= p_keep then repeat('•', length(p_value))
    else repeat('•', length(p_value) - p_keep) || right(p_value, p_keep)
  end;
$$;

drop view if exists v_patient_directory;
create view v_patient_directory
with (security_invoker = on) as
select
  p.id,
  p.organization_id,
  p.branch_id,
  p.name_ar,
  p.name_en,
  p.file_number,
  p.gender,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.id_number else app_mask_text(p.id_number) end       as id_number,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.phone_1  else app_mask_text(p.phone_1)  end         as phone_1,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.email_1  else app_mask_text(p.email_1, 0) end       as email_1,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.birth_date else null end                            as birth_date,
  -- العمر يبقى ظاهرًا لأنه ضرورة سريرية، والتاريخ الدقيق معرّف شخصي
  case when p.birth_date is not null
       then extract(year from age(p.birth_date))::int end         as age_years,
  app_has_permission(p.organization_id, 'patients.view_identity') as identity_visible,
  app_has_permission(p.organization_id, 'patients.view_medical')  as medical_visible,
  app_has_permission(p.organization_id, 'patients.view_financial') as financial_visible,
  p.created_at
from patients p;

comment on view v_patient_directory is
  'دليل المرضى بإخفاءٍ حسب الدور. الإخفاء في القاعدة لا في الواجهة — ما تُخفيه الواجهة يبقى في الاستجابة.';

-- ===========================================================================
-- 8) RLS للجداول الجديدة
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['medical_record_access_log','patient_consents',
                               'data_retention_policies']) as t
  loop
    -- الحذف بالبحث لا بتخمين الاسم: أسماء السياسات تختلف بين البيئات
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;

    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);

    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);

    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);
  end loop;
end $$;

-- **سجل الوصول لا يُعدَّل ولا يُحذف.** سجلٌّ يمكن تعديله ليس سجلًّا.
create or replace function app_block_access_log_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'سجل الوصول للملف الطبي لا يُعدَّل ولا يُحذف';
end $$;

drop trigger if exists trg_block_access_log_change on medical_record_access_log;
create trigger trg_block_access_log_change
  before update or delete on medical_record_access_log
  for each row execute function app_block_access_log_change();

grant select on v_patient_directory to authenticated;
grant select, insert on medical_record_access_log to authenticated;
grant select, insert, update on patient_consents to authenticated;
grant select, insert, update on data_retention_policies to authenticated;

-- ===========================================================================
-- 9) جرد شامل: إغلاق كل دالّة SECURITY DEFINER أمام anon
-- ===========================================================================
--
-- يُنفَّذ هنا لا في القسم 2، ليشمل دوال هذه الهجرة نفسها في البيئات التي
-- لا يُركَّب فيها مُحفِّز الأحداث.
do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    -- دوال مُحفِّزات الأحداث لا تُستدعى مباشرةً، فلا تُمنح لأحد
    if (select p.prorettype from pg_proc p where p.oid = r.sig::oid)
       <> 'event_trigger'::regtype then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    v_count := v_count + 1;
  end loop;
  raise notice 'أُغلق % دالّة SECURITY DEFINER أمام anon', v_count;
end $$;

-- ===========================================================================
-- 9.5) مستشار الأمان — يُعاد تشغيله بعد كل هجرة
-- ===========================================================================
--
-- بديلٌ محليّ عن Security/Performance Advisors في Supabase: يفحص نفس
-- العائلات ويبقى داخل المشروع فيُشغَّل في أي بيئة.
drop view if exists v_security_advisor;
create view v_security_advisor
with (security_invoker = on) as
-- جدول بلا RLS
select 'rls_disabled'::text as finding_type,
       'خطر'::text          as severity,
       c.relname::text      as object_name,
       'جدول بلا RLS — أي مستخدم مسجَّل يقرأ كل المنشآت'::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
union all
-- RLS مفعّلة بلا سياسات = منع كامل (غالبًا سهو)
select 'rls_no_policy', 'تحذير', c.relname::text,
       'RLS مفعّلة بلا سياسة — الجدول محجوب كليًّا عن المستخدمين'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
   and not exists (select 1 from pg_policies pp
                    where pp.schemaname = 'public' and pp.tablename = c.relname)
union all
-- دالّة SECURITY DEFINER بلا search_path مثبَّت
select 'definer_no_search_path', 'خطر', p.proname::text,
       'دالّة SECURITY DEFINER بلا search_path مثبَّت — عرضة لاختطاف المسار'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
union all
-- دالّة SECURITY DEFINER ما زالت مفتوحة لـ anon
select 'definer_anon_execute', 'خطر', p.proname::text,
       'دالّة SECURITY DEFINER قابلة للاستدعاء من anon — تتخطّى RLS بلا مستخدم'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('anon', p.oid, 'execute')
union all
-- منظور بلا security_invoker: يقرأ بصلاحيات مالكه فيتخطّى العزل
select 'view_no_invoker', 'خطر', c.relname::text,
       'منظور بلا security_invoker — يقرأ بصلاحيات مالكه ويتخطّى عزل المنشآت'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v'
   and c.relname like 'v\_%'
   and coalesce(c.reloptions::text, '') not like '%security_invoker=on%'
union all
-- سياسة على جدول له organization_id لا تذكر العزل ولا تستعمل دالّة عضوية
select 'policy_without_org_scope', 'تحذير', pp.tablename::text,
       format('سياسة %s لا تذكر organization_id ولا دالّة عضوية', pp.policyname)
  from pg_policies pp
 where pp.schemaname = 'public'
   and exists (select 1 from information_schema.columns col
                where col.table_schema = 'public' and col.table_name = pp.tablename
                  and col.column_name = 'organization_id')
   and coalesce(pp.qual, '') || coalesce(pp.with_check, '') not like '%organization_id%'
   and coalesce(pp.qual, '') || coalesce(pp.with_check, '') not like '%app_is_%'
   and coalesce(pp.qual, '') || coalesce(pp.with_check, '') not like '%app_has_%'
union all
-- أداء: مفتاح أجنبي بلا فهرس يغطّيه — كل حذف في الأب يمسح الابن كاملًا.
--
-- **يُبلَّغ عنه للجداول الكبيرة فقط** (أكثر من ألف صفّ تقديريًّا). المخطّط
-- فيه مئات المفاتيح الأجنبية على جداول مرجعية صغيرة، والإبلاغ عنها كلّها
-- يُغرق التقرير في ضجيج يُخفي النتائج الأمنية التي تهمّ.
select 'fk_without_index', 'أداء',
       (con.conrelid::regclass)::text,
       format('مفتاح أجنبي %s بلا فهرس على جدول بـ %s صفّ تقديريًّا',
              con.conname, c.reltuples::bigint)
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where con.contype = 'f' and n.nspname = 'public'
   and c.reltuples > 1000
   and not exists (
     select 1 from pg_index i
      where i.indrelid = con.conrelid
        and con.conkey <@ (select array_agg(k) from unnest(i.indkey::int2[]) k));

comment on view v_security_advisor is
  'مستشار أمان وأداء محليّ: RLS والمسارات وanon والمناظير والعزل والفهارس الناقصة. يُقرأ بعد كل هجرة.';

-- **لا يُمنح للمستخدمين.** قائمةُ الجداول التي تنقصها RLS خارطةُ هجوم جاهزة
-- لمن يقرؤها؛ هذا المنظور أداةُ مشغّل تُقرأ من محرّر SQL أو خدمة خلفية.
revoke all on v_security_advisor from authenticated, anon;

-- ===========================================================================
-- 10) فحص ذاتي — يفشل عند أي خرق أمنيّ من الفئات الحرجة
-- ===========================================================================
do $$
declare
  v_n int;
  v_list text;
begin
  select count(*), string_agg(object_name, ', ')
    into v_n, v_list
    from v_security_advisor
   where finding_type in ('rls_disabled','definer_no_search_path','definer_anon_execute');
  if v_n > 0 then
    raise exception 'خروق أمنية حرجة (%): %', v_n, left(v_list, 500);
  end if;

  select count(*), string_agg(object_name, ', ')
    into v_n, v_list
    from v_security_advisor where finding_type = 'view_no_invoker';
  if v_n > 0 then
    raise exception 'مناظير بلا security_invoker (%): %', v_n, left(v_list, 500);
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'audit_log'
                    and column_name = 'branch_id') then
    raise exception 'سجل التدقيق بلا فرع';
  end if;

  if not exists (select 1 from pg_indexes where indexname = 'uq_active_consent') then
    raise exception 'لا حارس لتعدّد الموافقات السارية';
  end if;
end $$;


-- ==========================================================================
-- [7/11]  0096_packages_and_subscriptions.sql
--          الباقات والاشتراكات
-- ==========================================================================

-- ============================================================================
-- 0096 — المرحلة 16: الباقات والاشتراكات الطبية
-- ============================================================================
--
-- **ما كان قائمًا وما ينقصه**
--
-- الجداول الأربعة (`packages`, `package_items`, `patient_packages`,
-- `patient_package_usages`) موجودة منذ 0016، وفيها مدّة صلاحية وعدد مرّات لكل
-- خدمة. لكن الباقة كانت **ورقةً لا عقدًا**:
--
--   • تُباع بإدراج صفٍّ مباشرةً بلا فاتورة — فيدخل المريض برصيدٍ لم يُدفع.
--   • الاستخدام يُخصم **يدويًّا** من شاشة الباقات؛ فمن نفّذ الخدمة في العيادة
--     لا يعرف أنها من باقة، فتُفوتَر مرّةً ثانية على المريض.
--   • لا تجميد ولا إلغاء ولا تجديد ولا استرداد.
--   • لا أهلية عمر ولا جنس ولا فرع ولا طبيب.
--
-- هذه الهجرة تجعلها عقدًا: تُباع بفاتورة، وتُخصم **عند تنفيذ الخدمة تلقائيًّا**،
-- فلا تُفوتَر مرّتين، وتُجمَّد وتُلغى وتُجدَّد ويُسترَدّ غيرُ المستخدَم منها وفق
-- سياسة مكتوبة.
--
-- **لا حذف**: الباقة الملغاة والاستخدام المُلغى يبقيان مسجَّلَين.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) تعريف الباقة: السعر والأهلية والنطاق والسياسة
-- ===========================================================================
alter table packages
  add column if not exists branch_id            uuid references branches(id),
  add column if not exists subscription_type    text not null default 'one_time',
  add column if not exists list_price           numeric(14,2),
  add column if not exists min_age_years        integer,
  add column if not exists max_age_years        integer,
  add column if not exists gender_restriction   text,
  add column if not exists allowed_doctor_ids   uuid[],
  add column if not exists allowed_specialty_value_id uuid references lookup_values(id),
  add column if not exists is_transferable      boolean not null default false,
  add column if not exists is_refundable        boolean not null default true,
  add column if not exists refund_policy        text,
  add column if not exists max_renewals         integer,
  add column if not exists description_ar       text,
  add column if not exists is_archived          boolean not null default false,
  add column if not exists archived_at          timestamptz,
  add column if not exists archived_by          uuid references auth.users(id),
  add column if not exists created_by           uuid references auth.users(id),
  add column if not exists updated_at           timestamptz not null default now(),
  add column if not exists updated_by           uuid references auth.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'packages_subscription_type_check') then
    alter table packages add constraint packages_subscription_type_check
      check (subscription_type in ('one_time','monthly','quarterly','annual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packages_gender_check') then
    alter table packages add constraint packages_gender_check
      check (gender_restriction is null or gender_restriction in ('male','female'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packages_age_range_check') then
    alter table packages add constraint packages_age_range_check
      check (min_age_years is null or max_age_years is null or min_age_years <= max_age_years);
  end if;
end $$;

comment on column packages.list_price is
  'مجموع أسعار الخدمات مفردةً. الفرق بينه وبين `price` هو وفر الباقة الذي يُعرض للمريض — يُحسب تلقائيًّا من البنود إن تُرك فارغًا.';
comment on column packages.branch_id is
  'فرع الباقة، أو NULL لباقة متاحة في كل الفروع.';
comment on column packages.is_transferable is
  'قابلية نقل الرصيد المتبقّي إلى مريض آخر. الافتراضي المنع: النقل الحرّ يجعل الباقة عملةً تُتداول.';

-- **حدّ الاستخدام لكل زيارة** على مستوى البند: باقة بعشرين جلسة لا تُستهلك
-- في يوم واحد.
alter table package_items
  add column if not exists organization_id       uuid references organizations(id),
  add column if not exists max_per_visit         numeric(10,2),
  add column if not exists min_days_between_uses integer,
  add column if not exists sort_order            integer not null default 0;

update package_items pi
   set organization_id = pk.organization_id
  from packages pk
 where pi.package_id = pk.id and pi.organization_id is null;

-- ===========================================================================
-- 2) اشتراك المريض: الفرع، والتجميد، والإلغاء، والتجديد، والاسترداد
-- ===========================================================================
alter table patient_packages
  add column if not exists branch_id        uuid references branches(id),
  add column if not exists price_paid       numeric(14,2),
  add column if not exists frozen_at        timestamptz,
  add column if not exists frozen_days      integer not null default 0,
  add column if not exists freeze_reason    text,
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references auth.users(id),
  add column if not exists cancel_reason    text,
  add column if not exists refunded_amount  numeric(14,2) not null default 0,
  add column if not exists refund_note_id   uuid references sales_invoices(id),
  add column if not exists renewed_from_id  uuid references patient_packages(id),
  add column if not exists renewal_count    integer not null default 0,
  add column if not exists transferred_from_patient_id uuid references patients(id),
  add column if not exists transferred_at   timestamptz,
  add column if not exists created_by       uuid references auth.users(id),
  add column if not exists updated_at       timestamptz not null default now(),
  add column if not exists updated_by       uuid references auth.users(id);

-- الحالة تتّسع: التجميد والإلغاء والاسترداد حالاتٌ لا شطبٌ للصف
do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'patient_packages'::regclass and conname like '%status%';
  if v_con is not null then
    execute format('alter table patient_packages drop constraint %I', v_con);
  end if;
  -- الترتيب مقصود: تُوسَّع القيم قبل تثبيت القيد، لا بعده
  alter table patient_packages add constraint patient_packages_status_check
    check (status in ('active','frozen','expired','consumed','cancelled','refunded'));
end $$;

create index if not exists idx_patient_packages_active
  on patient_packages (organization_id, patient_id, status)
  where status in ('active','frozen');

-- ربط الاستخدام بالخدمة المنفَّذة: بدونه لا يُعرف أيّ خدمةٍ خصمت الرصيد
alter table patient_package_usages
  add column if not exists organization_id  uuid references organizations(id),
  add column if not exists visit_service_id uuid references patient_visit_services(id),
  add column if not exists visit_id         uuid references patient_visits(id),
  add column if not exists is_reversed      boolean not null default false,
  add column if not exists reversed_at      timestamptz,
  add column if not exists reversed_by      uuid references auth.users(id),
  add column if not exists reversal_reason  text;

update patient_package_usages u
   set organization_id = pp.organization_id
  from patient_packages pp
 where u.patient_package_id = pp.id and u.organization_id is null;

-- استخدامٌ واحد لكل خدمة منفَّذة: الحارس ضدّ الخصم المزدوج عند إعادة
-- تشغيل المُحفِّز أو تعديل حالة الخدمة مرّتين.
create unique index if not exists uq_usage_per_visit_service
  on patient_package_usages (visit_service_id)
  where visit_service_id is not null and not is_reversed;

alter table patient_visit_services
  add column if not exists package_usage_id uuid references patient_package_usages(id);

comment on column patient_visit_services.package_usage_id is
  'استخدام الباقة الذي غطّى هذه الخدمة. وجودُه يعني أن الخدمة **مدفوعة سلفًا**، فتُفوتَر بصفرٍ لا بسعرها.';

-- ===========================================================================
-- 3) أهلية الشراء
-- ===========================================================================
create or replace function app_check_package_eligibility(
  p_package_id uuid,
  p_patient_id uuid,
  p_branch_id  uuid default null,
  p_doctor_id  uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pk     packages%rowtype;
  v_pat    patients%rowtype;
  v_age    integer;
  v_blocks text[] := '{}';
begin
  select * into v_pk from packages where id = p_package_id;
  if v_pk.id is null then raise exception 'الباقة غير موجودة'; end if;
  select * into v_pat from patients where id = p_patient_id;
  if v_pat.id is null then raise exception 'المريض غير موجود'; end if;

  if v_pk.organization_id <> v_pat.organization_id then
    raise exception 'الباقة والمريض في منشأتين مختلفتين';
  end if;

  if coalesce(v_pk.is_active, true) is not true or coalesce(v_pk.is_archived, false) then
    v_blocks := v_blocks || ('الباقة غير مفعّلة أو مؤرشفة')::text;
  end if;

  -- الفرع: باقة الفرع لا تُباع في فرع آخر
  if v_pk.branch_id is not null and p_branch_id is not null
     and v_pk.branch_id <> p_branch_id then
    v_blocks := v_blocks || ('الباقة غير متاحة في هذا الفرع')::text;
  end if;

  -- العمر يُحسب لحظة البيع؛ ومريضٌ بلا تاريخ ميلاد لا يُقاس عليه شرطُ عمر
  if v_pat.birth_date is not null then
    v_age := extract(year from age(v_pat.birth_date))::int;
    if v_pk.min_age_years is not null and v_age < v_pk.min_age_years then
      v_blocks := v_blocks || (format('العمر %s أقلّ من حدّ الباقة %s', v_age, v_pk.min_age_years))::text;
    end if;
    if v_pk.max_age_years is not null and v_age > v_pk.max_age_years then
      v_blocks := v_blocks || (format('العمر %s أكبر من حدّ الباقة %s', v_age, v_pk.max_age_years))::text;
    end if;
  elsif v_pk.min_age_years is not null or v_pk.max_age_years is not null then
    v_blocks := v_blocks || ('الباقة مقيَّدة بالعمر وتاريخ ميلاد المريض غير مسجَّل')::text;
  end if;

  if v_pk.gender_restriction is not null
     and coalesce(v_pat.gender, '') <> v_pk.gender_restriction then
    v_blocks := v_blocks || ('الباقة مخصَّصة لجنس آخر')::text;
  end if;

  if v_pk.allowed_doctor_ids is not null and array_length(v_pk.allowed_doctor_ids, 1) > 0
     and p_doctor_id is not null
     and not (p_doctor_id = any(v_pk.allowed_doctor_ids)) then
    v_blocks := v_blocks || ('الطبيب غير مشمول بالباقة')::text;
  end if;

  -- **التخصّص المسموح**: عمودٌ يَعِد بقيدٍ ولا يفرضه أسوأ من غيابه، لأن
  -- الموظّف يظنّ الباقة محميّة. يُفرض هنا كما يُفرض قيد الطبيب.
  if v_pk.allowed_specialty_value_id is not null and p_doctor_id is not null then
    if not exists (select 1 from doctors d
                    where d.id = p_doctor_id
                      and d.specialty_value_id = v_pk.allowed_specialty_value_id) then
      v_blocks := v_blocks || ('تخصّص الطبيب غير مشمول بالباقة')::text;
    end if;
  end if;

  return jsonb_build_object(
    'eligible', array_length(v_blocks, 1) is null,
    'blocks',   to_jsonb(v_blocks),
    'age',      v_age);
end $$;

-- ===========================================================================
-- 3.5) مصدر الضريبة يقبل بندًا بلا صنف
-- ===========================================================================
--
-- `app_compute_line_tax` (المرحلة 12) كان يرفض `p_item_id` فارغًا. لكن في
-- الفاتورة بنودٌ حقيقية بلا صنف: **الباقة** كوحدة، والبند اليدويّ المسموح
-- بصلاحية `billing.manual_line`. رفضُها هنا يدفع كل مسار منها إلى حساب
-- ضريبته بنفسه — وهو بالضبط ازدواج منطق الضريبة الذي وحّدته المرحلة 12.
--
-- البند بلا صنف **خاضع بنسبة المنشأة**: لا إعفاء بلا صنفٍ يحمل سببه، لأن
-- الإعفاء الصامت أخطر من الاحتساب الزائد.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_compute_line_tax';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'دالّة حساب ضريبة البند غير موجودة'; end if;
  if position('p_item_id is not null' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    E'  select * into v_item from items where id = p_item_id;\n'
    '  if v_item.id is null then raise exception ''الصنف غير موجود''; end if;',
    E'  if p_item_id is not null then\n'
    '    select * into v_item from items where id = p_item_id;\n'
    '    -- معرّفٌ لا يقابله صنف ما زال خطأً: الصمت هنا يُخفي بندًا فاسدًا\n'
    '    if v_item.id is null then raise exception ''الصنف غير موجود''; end if;\n'
    '  end if;');

  if v_new = v_src then
    raise exception 'تعذّر توسيع دالّة الضريبة لتقبل بندًا بلا صنف';
  end if;
  execute v_new;
end $$;

-- ===========================================================================
-- 4) البيع: باقةٌ لا تدخل رصيد المريض إلا بفاتورة
-- ===========================================================================
create or replace function app_sell_package(
  p_package_id uuid,
  p_patient_id uuid,
  p_branch_id  uuid default null,
  p_doctor_id  uuid default null,
  p_clinic_id  uuid default null,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pk       packages%rowtype;
  v_elig     jsonb;
  v_invoice  uuid;
  v_pp       uuid;
  v_branch   uuid;
  v_price    numeric;
  v_vat      record;
begin
  select * into v_pk from packages where id = p_package_id;
  if v_pk.id is null then raise exception 'الباقة غير موجودة'; end if;

  if not app_has_permission(v_pk.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح ببيع الباقات (billing.issue)';
  end if;

  v_branch := coalesce(p_branch_id, v_pk.branch_id,
                       (select id from branches
                         where organization_id = v_pk.organization_id
                         order by is_main desc nulls last, created_at limit 1));

  v_elig := app_check_package_eligibility(p_package_id, p_patient_id, v_branch, p_doctor_id);
  if (v_elig->>'eligible')::boolean is not true then
    raise exception 'المريض غير مؤهّل للباقة: %',
      array_to_string(array(select jsonb_array_elements_text(v_elig->'blocks')), '؛ ');
  end if;

  -- باقة سارية واحدة من نفس النوع: بيع ثانيةٍ قبل استهلاك الأولى يُنشئ
  -- رصيدين متوازيين لا يعرف الموظّف من أيّهما يخصم.
  if exists (select 1 from patient_packages
              where patient_id = p_patient_id and package_id = p_package_id
                and status in ('active','frozen')) then
    raise exception 'للمريض باقة سارية من هذا النوع — جدّدها أو استهلكها أولًا';
  end if;

  v_price := coalesce(v_pk.price, 0);

  -- الفاتورة أوّلًا، فالرصيد تابعٌ لها
  insert into sales_invoices (organization_id, branch_id, clinic_id, doctor_id,
                              patient_id, status, invoice_type, note, created_by)
  values (v_pk.organization_id, v_branch, p_clinic_id, p_doctor_id,
          p_patient_id, 'draft', 'sale',
          coalesce(p_note, format('باقة: %s', v_pk.name_ar)), auth.uid())
  returning id into v_invoice;

  -- الضريبة على الباقة كوحدة، لا على بنودها: البند المعفى داخل باقة خاضعة
  -- لا يجعل الباقة معفاة، والعكس. الحساب من مصدر المرحلة 12.
  select t.vat_category, t.vat_rate, t.vat_amount, t.exemption_reason, t.taxable_base
    into v_vat
    from app_compute_line_tax(v_pk.organization_id, null, p_patient_id,
                              v_price, 1, 0) t;

  -- **الاشتراك يُنشأ قبل بند الفاتورة** ليكون هو مصدر البند.
  --
  -- `uq_invoice_source_once` (المرحلة 11) يمنع تفويتر المصدر الواحد مرّتين.
  -- لو جعلنا المصدر `package_id` لَما بيعت الباقة إلا مرّةً واحدة في عمر
  -- المنشأة كلّها — والمصدر الصحيح هو **اشتراك هذا المريض**، فهو الحدث
  -- الذي لا يتكرّر.
  insert into patient_packages (organization_id, branch_id, patient_id, package_id,
                                sales_invoice_id, status, price_paid, created_by)
  values (v_pk.organization_id, v_branch, p_patient_id, p_package_id,
          v_invoice, 'active', v_price, auth.uid())
  returning id into v_pp;

  insert into sales_invoice_items (
    organization_id, invoice_id, branch_id, patient_id, item_id, description,
    line_type, price, qty, list_price,
    vat_category, vat_rate, vat_amount, taxable_base, exemption_reason,
    net_amount, patient_share, insurer_share,
    source_type, source_id, item_name_snapshot)
  values (
    v_pk.organization_id, v_invoice, v_branch, p_patient_id, null,
    format('باقة: %s', v_pk.name_ar),
    'normal', v_price, 1, coalesce(v_pk.list_price, v_price),
    v_vat.vat_category, v_vat.vat_rate, v_vat.vat_amount, v_vat.taxable_base,
    v_vat.exemption_reason,
    v_price + coalesce(v_vat.vat_amount, 0), v_price + coalesce(v_vat.vat_amount, 0), 0,
    'package', v_pp, format('باقة: %s', v_pk.name_ar));

  update sales_invoices
     set subtotal_amount = v_price,
         vat_amount      = coalesce(v_vat.vat_amount, 0),
         net_amount      = v_price + coalesce(v_vat.vat_amount, 0),
         patient_share_amount = v_price + coalesce(v_vat.vat_amount, 0)
   where id = v_invoice;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_pk.organization_id, auth.uid(), 'packages', 'add', v_pp, 'بيع باقة',
          format('بيعت باقة %s بفاتورة مسوّدة %s', v_pk.name_ar, v_invoice));

  return jsonb_build_object('patient_package_id', v_pp, 'invoice_id', v_invoice);
end $$;

-- ===========================================================================
-- 5) الخصم التلقائي عند تنفيذ الخدمة
-- ===========================================================================
--
-- **هذا هو قلب المرحلة.** الخصم اليدويّ من شاشة الباقات يعني أن من ينفّذ
-- الخدمة في العيادة لا يعرف أنها من باقة، فتُفوتَر على المريض مرّةً ثانية —
-- وهو خطأٌ يُكتشف بعد الدفع لا قبله.
create or replace function app_claim_package_coverage(
  p_patient_id  uuid,
  p_item_id     uuid,
  p_qty         numeric,
  p_visit_id    uuid default null,
  p_service_id  uuid default null,
  p_doctor_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row       record;
  v_usage     uuid;
  v_last_use  timestamptz;
begin
  if coalesce(p_qty, 0) <= 0 then return null; end if;

  -- **الأقرب انتهاءً أوّلًا** — نفس منطق FEFO في المخزون: الرصيد الذي
  -- ينتهي غدًا يُستهلك قبل الذي ينتهي بعد سنة، وإلا ضاع.
  for v_row in
    select pp.id            as patient_package_id,
           pp.organization_id,
           pp.expires_at,
           pi.id            as package_item_id,
           pi.quantity_included,
           pi.max_per_visit,
           pi.min_days_between_uses,
           coalesce((select sum(u.quantity_used) from patient_package_usages u
                      where u.patient_package_id = pp.id
                        and u.package_item_id = pi.id
                        and not u.is_reversed), 0) as used
      from patient_packages pp
      join packages pk on pk.id = pp.package_id
      join package_items pi on pi.package_id = pp.package_id
     where pp.patient_id = p_patient_id
       and pi.item_id = p_item_id
       and pp.status = 'active'                      -- المجمَّدة لا تُخصَم منها
       and (pp.expires_at is null or pp.expires_at > now())
       and (pk.allowed_doctor_ids is null
            or array_length(pk.allowed_doctor_ids, 1) is null
            or p_doctor_id is null
            or p_doctor_id = any(pk.allowed_doctor_ids))
       -- التخصّص يُفحص عند الخصم أيضًا لا عند البيع فقط: الباقة قد تُباع
       -- بلا طبيب محدَّد ثم تُستهلك عند طبيبٍ من تخصّص آخر.
       and (pk.allowed_specialty_value_id is null
            or p_doctor_id is null
            or exists (select 1 from doctors d
                        where d.id = p_doctor_id
                          and d.specialty_value_id = pk.allowed_specialty_value_id))
     order by pp.expires_at nulls last, pp.purchased_at
  loop
    if v_row.quantity_included - v_row.used < p_qty then
      continue;  -- رصيد هذه الباقة لا يكفي الكمّية كاملةً
    end if;

    if v_row.max_per_visit is not null and p_qty > v_row.max_per_visit then
      continue;  -- تتجاوز حدّ الزيارة الواحدة
    end if;

    if v_row.min_days_between_uses is not null then
      select max(u.used_at) into v_last_use
        from patient_package_usages u
       where u.patient_package_id = v_row.patient_package_id
         and u.package_item_id = v_row.package_item_id
         and not u.is_reversed;
      if v_last_use is not null
         and v_last_use > now() - make_interval(days => v_row.min_days_between_uses) then
        continue;  -- المدّة بين الاستخدامين لم تكتمل
      end if;
    end if;

    insert into patient_package_usages (organization_id, patient_package_id,
                                        package_item_id, quantity_used, used_by,
                                        visit_id, visit_service_id, note)
    values (v_row.organization_id, v_row.patient_package_id, v_row.package_item_id,
            p_qty, auth.uid(), p_visit_id, p_service_id, 'خصم تلقائي عند تنفيذ الخدمة')
    returning id into v_usage;

    -- الباقة المستهلَكة كاملةً تُغلق، فلا تظهر في قوائم الاختيار
    if not exists (
      select 1 from package_items pi2
       where pi2.package_id = (select package_id from patient_packages
                                where id = v_row.patient_package_id)
         and pi2.quantity_included >
             coalesce((select sum(u2.quantity_used) from patient_package_usages u2
                        where u2.patient_package_id = v_row.patient_package_id
                          and u2.package_item_id = pi2.id
                          and not u2.is_reversed), 0)
    ) then
      update patient_packages set status = 'consumed', updated_at = now()
       where id = v_row.patient_package_id;
    end if;

    return v_usage;
  end loop;

  return null;
end $$;

create or replace function app_auto_consume_package()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit patient_visits%rowtype;
  v_usage uuid;
begin
  -- الخصم عند **التنفيذ** لا عند الطلب: خدمةٌ طُلبت ولم تُنفَّذ لا تُنقص رصيدًا
  if new.status <> 'performed' then return new; end if;
  if new.package_usage_id is not null then return new; end if;
  if TG_OP = 'UPDATE' and old.status = 'performed' then return new; end if;

  select * into v_visit from patient_visits where id = new.visit_id;
  if v_visit.id is null then return new; end if;

  v_usage := app_claim_package_coverage(
    v_visit.patient_id, new.item_id, coalesce(new.qty, 1),
    new.visit_id, new.id, coalesce(new.performed_by, v_visit.doctor_id));

  if v_usage is not null then
    update patient_visit_services set package_usage_id = v_usage where id = new.id;
  end if;

  return new;
end $$;

drop trigger if exists trg_auto_consume_package on patient_visit_services;
create trigger trg_auto_consume_package
  after insert or update of status on patient_visit_services
  for each row execute function app_auto_consume_package();

-- ===========================================================================
-- 6) الفوترة تحترم التغطية: الخدمة المغطّاة تُعرض ولا تُحمَّل
-- ===========================================================================
--
-- تُعرض بصفرٍ ولا تُحذف من الفاتورة: المريض يرى ما تلقّاه، ويرى أنه مشمول
-- بباقته. الحذف كان سيجعل الفاتورة تكذب على المريض بالنقصان.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_invoice_from_visit';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'دالّة الفوترة من الزيارة غير موجودة'; end if;
  if position('package_usage_id' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    'select s.id, s.item_id, s.qty, s.unit_price,',
    'select s.id, s.item_id, s.qty,'
    || ' case when s.package_usage_id is not null then 0 else s.unit_price end as unit_price,'
    || ' s.package_usage_id,');

  if v_new = v_src then
    raise exception 'تعذّر ترقيع دالّة الفوترة — تغيّر نصّها';
  end if;

  -- السعر المحسوب من قائمة الأسعار يُلغى أيضًا للخدمة المغطّاة
  v_new := replace(v_new,
    'v_amount := coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) * coalesce(v_src.qty, 1);',
    'if v_src.package_usage_id is not null then'
    || ' v_amount := 0;'
    || ' else'
    || ' v_amount := coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) * coalesce(v_src.qty, 1);'
    || ' end if;');

  v_new := replace(v_new,
    E'      from app_compute_line_tax(v_visit.organization_id, v_src.item_id,\n'
    '                                v_visit.patient_id,\n'
    '                                coalesce(nullif(v_src.unit_price, 0), v_price.price, 0),\n'
    '                                coalesce(v_src.qty, 1), 0) t;',
    E'      from app_compute_line_tax(v_visit.organization_id, v_src.item_id,\n'
    '                                v_visit.patient_id,\n'
    '                                case when v_src.package_usage_id is not null then 0\n'
    '                                     else coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) end,\n'
    '                                coalesce(v_src.qty, 1), 0) t;');

  -- **سعر البند نفسه** لا مجموعه فقط.
  --
  -- `v_amount` يُصفَّر أعلاه، لكن عمود `price` في البند يُحسب من تعبيره
  -- الخاص: `coalesce(nullif(unit_price,0), v_price.price, 0)`. وبما أن
  -- `nullif(0,0)` تُعيد NULL، كان السعر يرتدّ إلى قائمة الأسعار فيظهر البند
  -- بـ 200 وصافيه صفر — رقمان متناقضان في السطر الواحد.
  v_new := replace(v_new,
    'coalesce(nullif(v_src.unit_price, 0), v_price.price, 0), coalesce(v_src.qty, 1),',
    'case when v_src.package_usage_id is not null then 0'
    || ' else coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) end,'
    || ' coalesce(v_src.qty, 1),');

  -- الوصف يقول للمريض لماذا البند بصفر
  v_new := replace(v_new,
    'v_invoice, v_src.item_id, v_src.doctor_id, v_src.name_ar, ''normal'',',
    'v_invoice, v_src.item_id, v_src.doctor_id,'
    || ' case when v_src.package_usage_id is not null'
    || '      then v_src.name_ar || '' (مشمولة بالباقة)'' else v_src.name_ar end, ''normal'',');

  execute v_new;
end $$;

-- ===========================================================================
-- 7) التجميد والاستئناف والإلغاء والتجديد والنقل والاسترداد
-- ===========================================================================

-- التجميد **يوقف عدّاد الصلاحية**. بلا ذلك يخسر المريض أيّام تجميده،
-- فيصير التجميد عقوبةً لا خدمة.
create or replace function app_freeze_patient_package(
  p_patient_package_id uuid,
  p_reason             text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_pp patient_packages%rowtype;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  if not app_has_permission(v_pp.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بإدارة الاشتراكات (billing.issue)';
  end if;
  if v_pp.status <> 'active' then
    raise exception 'لا يُجمَّد اشتراك حالته %', v_pp.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب التجميد مطلوب'; end if;

  update patient_packages
     set status = 'frozen', frozen_at = now(), freeze_reason = p_reason,
         updated_at = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pp.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'تجميد اشتراك', 'جُمّد الاشتراك', p_reason);
end $$;

create or replace function app_resume_patient_package(p_patient_package_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp   patient_packages%rowtype;
  v_days integer;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  if not app_has_permission(v_pp.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بإدارة الاشتراكات (billing.issue)';
  end if;
  if v_pp.status <> 'frozen' then
    raise exception 'الاشتراك ليس مجمَّدًا (حالته %)', v_pp.status;
  end if;

  v_days := greatest(0, (extract(epoch from (now() - v_pp.frozen_at)) / 86400)::int);

  update patient_packages
     set status      = 'active',
         -- الصلاحية تُمدّ بعدد أيّام التجميد
         expires_at  = case when expires_at is not null
                            then expires_at + make_interval(days => v_days) end,
         frozen_days = frozen_days + v_days,
         frozen_at   = null,
         updated_at  = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_pp.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'استئناف اشتراك', format('استُؤنف بعد %s يومًا، ومُدّت الصلاحية بها', v_days));
end $$;

-- قيمة ما لم يُستخدَم — بالتناسب مع سعر الخدمات لا بالقسمة على العدد.
create or replace function app_package_unused_value(p_patient_package_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp        patient_packages%rowtype;
  v_total     numeric := 0;
  v_remaining numeric := 0;
  r           record;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id;
  if v_pp.id is null then return 0; end if;

  for r in
    select pi.quantity_included,
           coalesce(i.price, 0) as unit_price,
           coalesce((select sum(u.quantity_used) from patient_package_usages u
                      where u.patient_package_id = v_pp.id
                        and u.package_item_id = pi.id and not u.is_reversed), 0) as used
      from package_items pi
      join items i on i.id = pi.item_id
     where pi.package_id = v_pp.package_id
  loop
    v_total     := v_total + r.quantity_included * r.unit_price;
    v_remaining := v_remaining + greatest(0, r.quantity_included - r.used) * r.unit_price;
  end loop;

  if v_total <= 0 then return 0; end if;

  -- **بنسبة القيمة المتبقّية من قيمة الباقة كاملةً**، مطبَّقةً على ما دفعه
  -- المريض فعلًا. القسمة على عدد الحصص كانت تُعيد للمريض قيمة كشفٍ بسعر
  -- جلسة علاج طبيعي.
  return round(coalesce(v_pp.price_paid, 0) * (v_remaining / v_total), 2);
end $$;

create or replace function app_cancel_patient_package(
  p_patient_package_id uuid,
  p_reason             text,
  p_refund             boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp         patient_packages%rowtype;
  v_pk         packages%rowtype;
  v_unused     numeric := 0;
  v_note       uuid;
  v_line_id    uuid;
  v_line_price numeric;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  select * into v_pk from packages where id = v_pp.package_id;

  if not app_has_permission(v_pp.organization_id, 'billing.refund') then
    raise exception 'صلاحيتك لا تسمح بإلغاء الاشتراكات واستردادها (billing.refund)';
  end if;
  if v_pp.status in ('cancelled','refunded') then
    raise exception 'الاشتراك ملغى سلفًا';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الإلغاء مطلوب'; end if;

  if p_refund then
    if coalesce(v_pk.is_refundable, true) is not true then
      raise exception 'الباقة غير قابلة للاسترداد وفق سياستها: %',
        coalesce(v_pk.refund_policy, 'لا استرداد');
    end if;
    v_unused := app_package_unused_value(p_patient_package_id);
    if v_unused > 0 and v_pp.sales_invoice_id is not null then
      -- **إشعار دائن لا حذف للفاتورة** — الفاتورة المُصدَرة لا تُمَسّ (المرحلة 12).
      --
      -- `app_create_credit_note` تُصدر إشعارًا عن **بنود الفاتورة نفسها**
      -- بكمّية جزئية، لا عن بندٍ حرّ. وبند الباقة كمّيته واحدة وقيمتها كاملة،
      -- فالاسترداد الجزئي يُعبَّر عنه بكسرٍ من الكمّية يساوي نسبة ما لم
      -- يُستخدَم. بهذا تمرّ الضريبة والترقيم والقيود في نفس المسار المُختبَر
      -- بدل مسارٍ ثانٍ خاصّ بالباقات.
      select li.id, li.price into v_line_id, v_line_price
        from sales_invoice_items li
       where li.invoice_id = v_pp.sales_invoice_id
         and li.source_type = 'package'
       order by li.created_at limit 1;

      if v_line_id is null or coalesce(v_line_price, 0) <= 0 then
        raise exception 'بند الباقة غير موجود في الفاتورة — تعذّر إصدار الإشعار الدائن';
      end if;

      v_note := app_create_credit_note(
        v_pp.sales_invoice_id,
        format('استرداد غير المستخدَم من باقة %s: %s', v_pk.name_ar, p_reason),
        jsonb_build_array(jsonb_build_object(
          'invoice_item_id', v_line_id,
          'qty', round(v_unused / v_line_price, 6))),
        'credit_note');
    end if;
  end if;

  update patient_packages
     set status          = case when p_refund and v_unused > 0 then 'refunded' else 'cancelled' end,
         cancelled_at    = now(), cancelled_by = auth.uid(), cancel_reason = p_reason,
         refunded_amount = v_unused,
         refund_note_id  = v_note,
         updated_at      = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pp.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'إلغاء اشتراك',
          format('أُلغي الاشتراك%s', case when v_unused > 0
                 then format(' واسترُدّ %s', v_unused) else '' end),
          p_reason);

  return jsonb_build_object('refunded_amount', v_unused, 'credit_note_id', v_note);
end $$;

create or replace function app_renew_patient_package(
  p_patient_package_id uuid,
  p_note               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp  patient_packages%rowtype;
  v_pk  packages%rowtype;
  v_res jsonb;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  select * into v_pk from packages where id = v_pp.package_id;

  if v_pk.max_renewals is not null and v_pp.renewal_count >= v_pk.max_renewals then
    raise exception 'بلغ الاشتراك حدّ التجديدات (%)', v_pk.max_renewals;
  end if;

  -- القديم يُغلق أوّلًا حتى لا يصطدم بحارس «باقة سارية واحدة»
  update patient_packages
     set status = case when status in ('active','frozen') then 'consumed' else status end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  v_res := app_sell_package(v_pp.package_id, v_pp.patient_id, v_pp.branch_id,
                            null, null, coalesce(p_note, 'تجديد اشتراك'));

  update patient_packages
     set renewed_from_id = p_patient_package_id,
         renewal_count   = v_pp.renewal_count + 1
   where id = (v_res->>'patient_package_id')::uuid;

  return v_res;
end $$;

create or replace function app_transfer_patient_package(
  p_patient_package_id uuid,
  p_to_patient_id      uuid,
  p_reason             text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp patient_packages%rowtype;
  v_pk packages%rowtype;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  select * into v_pk from packages where id = v_pp.package_id;

  if not app_has_permission(v_pp.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بنقل الاشتراكات (billing.issue)';
  end if;
  if coalesce(v_pk.is_transferable, false) is not true then
    raise exception 'الباقة غير قابلة للنقل وفق تعريفها';
  end if;
  if v_pp.status not in ('active','frozen') then
    raise exception 'لا يُنقل اشتراك حالته %', v_pp.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب النقل مطلوب'; end if;

  -- المنقول إليه يجب أن يكون مؤهّلًا هو الآخر، وإلا صار النقل بابًا
  -- لتجاوز شروط العمر والجنس.
  if (app_check_package_eligibility(v_pp.package_id, p_to_patient_id,
                                    v_pp.branch_id, null)->>'eligible')::boolean is not true then
    raise exception 'المنقول إليه غير مؤهّل لهذه الباقة';
  end if;

  update patient_packages
     set transferred_from_patient_id = v_pp.patient_id,
         transferred_at = now(),
         patient_id     = p_to_patient_id,
         updated_at     = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pp.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'نقل اشتراك', 'نُقل الاشتراك إلى مريض آخر', p_reason);
end $$;

-- عكس الاستخدام حين تُلغى الخدمة بعد تنفيذها
create or replace function app_reverse_package_usage(
  p_usage_id uuid,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_u patient_package_usages%rowtype;
begin
  select * into v_u from patient_package_usages where id = p_usage_id for update;
  if v_u.id is null then raise exception 'الاستخدام غير موجود'; end if;
  if v_u.is_reversed then raise exception 'الاستخدام معكوس سلفًا'; end if;
  if not app_has_permission(v_u.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بعكس الاستخدام (billing.issue)';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب العكس مطلوب'; end if;

  -- **لا يُحذف السطر** — يُعلَّم معكوسًا ليبقى أثر الخصم والردّ معًا
  update patient_package_usages
     set is_reversed = true, reversed_at = now(), reversed_by = auth.uid(),
         reversal_reason = p_reason
   where id = p_usage_id;

  update patient_visit_services set package_usage_id = null
   where package_usage_id = p_usage_id;

  -- باقة أُغلقت لاستهلاكها تعود سارية بعد ردّ الرصيد
  update patient_packages set status = 'active', updated_at = now()
   where id = v_u.patient_package_id and status = 'consumed';

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_u.organization_id, auth.uid(), 'packages', 'update', p_usage_id,
          'عكس استخدام باقة', 'رُدّ الرصيد المخصوم', p_reason);
end $$;

-- ===========================================================================
-- 8) الحارس: الاستخدام المعكوس لا يُحتسب
-- ===========================================================================
--
-- `app_validate_package_usage` (0016) يفحص أربعة أشياء لا يجوز فقدان أيّها:
-- قفل الاشتراك ضدّ التزامن، وانتماء البند إلى باقة هذا الاشتراك، وموجبية
-- الكمّية، وملاءمة الخدمة السريرية للمريض. لذلك **يُرقَّع نصُّه** ولا يُعاد
-- كتابته: إعادة الكتابة كانت ستُسقط هذه الفحوص صامتةً.
--
-- الترقيع الوحيد المطلوب: استبعاد الاستخدام المعكوس من المجموع، وإلا بقي
-- الرصيد المردود محجوزًا فيُمنع المريض من خدمةٍ يملكها.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_validate_package_usage';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'حارس استخدام الباقة غير موجود'; end if;
  if position('is_reversed' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    E'   where package_item_id = new.package_item_id\n'
    '     and patient_package_id = new.patient_package_id;',
    E'   where package_item_id = new.package_item_id\n'
    '     and patient_package_id = new.patient_package_id\n'
    '     and not is_reversed;');

  if v_new = v_src then
    raise exception 'تعذّر ترقيع حارس الاستخدام — تغيّر نصّه';
  end if;

  -- المنشأة تُملأ من الاشتراك لتعمل RLS على سطر الاستخدام
  v_new := replace(v_new,
    E'  if new.used_by is null then',
    E'  new.organization_id := coalesce(new.organization_id, sub.organization_id);\n\n'
    '  if new.used_by is null then');

  execute v_new;
end $$;

-- ===========================================================================
-- 9) المناظير
-- ===========================================================================

-- سعر القائمة يُحسب من البنود إن لم يُحدَّد، ليظهر الوفر للمريض
drop view if exists v_package_catalog;
create view v_package_catalog
with (security_invoker = on) as
select
  pk.id, pk.organization_id, pk.branch_id, br.name as branch_name,
  pk.code, pk.name_ar, pk.name_en, pk.description_ar,
  pk.subscription_type, pk.validity_days,
  pk.price,
  coalesce(pk.list_price, agg.computed_list_price) as list_price,
  greatest(0, coalesce(pk.list_price, agg.computed_list_price) - pk.price) as savings,
  pk.min_age_years, pk.max_age_years, pk.gender_restriction,
  pk.allowed_doctor_ids, pk.allowed_specialty_value_id,
  pk.is_transferable, pk.is_refundable, pk.refund_policy, pk.max_renewals,
  pk.is_active, pk.is_archived,
  agg.item_count, agg.total_quantity,
  pk.created_at
from packages pk
left join branches br on br.id = pk.branch_id
left join lateral (
  select count(*)                         as item_count,
         sum(pi.quantity_included)        as total_quantity,
         sum(pi.quantity_included * coalesce(i.price, 0)) as computed_list_price
    from package_items pi
    join items i on i.id = pi.item_id
   where pi.package_id = pk.id
) agg on true;

comment on view v_package_catalog is
  'كتالوج الباقات بوفرها وأهليتها ونطاقها. سعر القائمة يُحسب من البنود إن لم يُحدَّد، فلا يظهر وفرٌ وهميّ.';

drop view if exists v_patient_subscriptions;
create view v_patient_subscriptions
with (security_invoker = on) as
select
  pp.id                as patient_package_id,
  pp.organization_id,
  pp.branch_id,
  br.name              as branch_name,
  pp.patient_id,
  p.name_ar            as patient_name,
  p.file_number,
  pp.package_id,
  pk.name_ar           as package_name,
  pk.subscription_type,
  pp.status,
  case
    when pp.status = 'active' and pp.expires_at is not null and pp.expires_at < now()
      then 'expired'
    else pp.status
  end                  as effective_status,
  pp.purchased_at,
  pp.expires_at,
  (pp.expires_at is not null and pp.expires_at < now()) as is_expired,
  case when pp.expires_at is not null
       then (pp.expires_at::date - current_date) end as days_remaining,
  pp.price_paid,
  pp.refunded_amount,
  pp.frozen_at,
  pp.frozen_days,
  pp.freeze_reason,
  pp.cancel_reason,
  pp.renewal_count,
  pp.renewed_from_id,
  pp.transferred_from_patient_id,
  pp.sales_invoice_id,
  inv.invoice_number,
  inv.status           as invoice_status,
  bal.total_included,
  bal.total_used,
  bal.total_remaining,
  app_package_unused_value(pp.id) as unused_value
from patient_packages pp
join patients p  on p.id  = pp.patient_id
join packages pk on pk.id = pp.package_id
left join branches br on br.id = pp.branch_id
left join sales_invoices inv on inv.id = pp.sales_invoice_id
left join lateral (
  select sum(pi.quantity_included) as total_included,
         sum(coalesce((select sum(u.quantity_used) from patient_package_usages u
                        where u.patient_package_id = pp.id
                          and u.package_item_id = pi.id and not u.is_reversed), 0))
           as total_used,
         sum(pi.quantity_included
             - coalesce((select sum(u.quantity_used) from patient_package_usages u
                          where u.patient_package_id = pp.id
                            and u.package_item_id = pi.id and not u.is_reversed), 0))
           as total_remaining
    from package_items pi where pi.package_id = pp.package_id
) bal on true;

comment on view v_patient_subscriptions is
  'اشتراكات المرضى برصيدها وصلاحيتها وحالتها الفعلية وقيمة غير المستخدَم. الحالة الفعلية تحسب الانتهاء، فلا يبدو منتهٍ ساريًا.';

-- `v_patient_package_balances` (0016) يجمع كل الاستخدامات بلا استثناء
-- المعكوس منها — فالرصيد المردود يبقى مخصومًا في الشاشة التي يقرأها
-- الموظّف، ويُمنع المريض من خدمةٍ يملكها. يُعاد بناؤه بنفس أعمدته.
drop view if exists v_patient_package_balances;
create view v_patient_package_balances
with (security_invoker = on) as
select
  pp.id                as patient_package_id,
  pp.organization_id,
  pp.patient_id,
  pt.name_ar           as patient_name,
  pp.package_id,
  pk.name_ar           as package_name,
  pp.status,
  pp.purchased_at,
  pp.expires_at,
  (pp.expires_at is not null and pp.expires_at < now()) as is_expired,
  case
    when pp.status <> 'active' then pp.status
    when pp.expires_at is not null and pp.expires_at < now() then 'expired'
    else 'active'
  end                  as effective_status,
  pi.id                as package_item_id,
  pi.item_id,
  it.name_ar           as item_name,
  pi.quantity_included,
  coalesce(sum(u.quantity_used), 0)                     as quantity_used,
  pi.quantity_included - coalesce(sum(u.quantity_used), 0) as quantity_remaining,
  it.requires_fasting,
  it.requires_consent,
  it.preparation_ar
from patient_packages pp
join patients pt on pt.id = pp.patient_id
join packages pk on pk.id = pp.package_id
join package_items pi on pi.package_id = pp.package_id
join items it on it.id = pi.item_id
left join patient_package_usages u
       on u.package_item_id = pi.id
      and u.patient_package_id = pp.id
      and not u.is_reversed          -- ← المعكوس لا يُخصم
group by pp.id, pp.organization_id, pp.patient_id, pt.name_ar, pp.package_id,
         pk.name_ar, pp.status, pp.purchased_at, pp.expires_at,
         pi.id, pi.item_id, it.name_ar, pi.quantity_included,
         it.requires_fasting, it.requires_consent, it.preparation_ar;

comment on view v_patient_package_balances is
  'أرصدة باقات المريض بحبّة البند. الاستخدام المعكوس لا يُخصم — الرصيد المردود متاحٌ فعلًا.';

grant select on v_patient_package_balances to authenticated;

drop view if exists v_package_usage_log;
create view v_package_usage_log
with (security_invoker = on) as
select
  u.id                as usage_id,
  u.organization_id,
  pp.branch_id,
  u.used_at           as report_date,
  pp.patient_id,
  p.name_ar           as patient_name,
  pp.id               as patient_package_id,
  pk.name_ar          as package_name,
  pi.item_id,
  i.name_ar           as item_name,
  u.quantity_used,
  u.visit_id,
  u.visit_service_id,
  u.appointment_id,
  u.used_by,
  u.is_reversed,
  u.reversed_at,
  u.reversal_reason,
  u.note
from patient_package_usages u
join patient_packages pp on pp.id = u.patient_package_id
join packages pk on pk.id = pp.package_id
join package_items pi on pi.id = u.package_item_id
join items i on i.id = pi.item_id
join patients p on p.id = pp.patient_id;

comment on view v_package_usage_log is
  'سجل استخدام الباقات، شاملًا المعكوس منه — الخصم والردّ يظهران معًا لا يُمحى أحدهما.';

grant select on v_package_catalog, v_patient_subscriptions, v_package_usage_log
  to authenticated;

-- ===========================================================================
-- 10) رحلة المريض تعرض البيع والاستخدام والاسترداد
-- ===========================================================================
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_get_patient_timeline';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'دالّة الخط الزمني غير موجودة'; end if;
  if position('package_sold' in v_src) > 0 then return; end if;

  -- تُضاف مجموعتان إلى تعبير `events` قبل قوسه الختامي. الترتيب الثابت
  -- لأعمدة المجموعة (١٣ عمودًا) مأخوذ من آخر مجموعة قائمة في الدالّة.
  v_new := replace(v_src,
    E'    from patient_documents pd\n'
    '    where pd.patient_id = p_patient_id\n'
    '  )',
    E'    from patient_documents pd\n'
    '    where pd.patient_id = p_patient_id\n'
    '\n'
    '    union all\n'
    '    -- بيع الباقة: يظهر في الرحلة بفاتورته لا كحدثٍ معلّق\n'
    '    select ''pkg:'' || pp.id::text,\n'
    '           ''package_sold'',\n'
    '           pp.purchased_at,\n'
    '           ''شراء باقة'',\n'
    '           pk.name_ar, pp.status, ''packages'',\n'
    '           pp.id, null::uuid, null::uuid, pp.sales_invoice_id, pp.created_by,\n'
    '           jsonb_build_object(''price_paid'', pp.price_paid,\n'
    '                              ''expires_at'', pp.expires_at)\n'
    '    from patient_packages pp\n'
    '    join packages pk on pk.id = pp.package_id\n'
    '    where pp.patient_id = p_patient_id\n'
    '\n'
    '    union all\n'
    '    -- الاستخدام والعكس كلاهما حدث: الرصيد المخصوم والمردود يظهران\n'
    '    select ''pkguse:'' || u.id::text,\n'
    '           ''package_used'',\n'
    '           u.used_at,\n'
    '           case when u.is_reversed then ''عكس استخدام باقة''\n'
    '                else ''استخدام من باقة'' end,\n'
    '           i.name_ar,\n'
    '           case when u.is_reversed then ''reversed'' else ''used'' end,\n'
    '           ''packages'',\n'
    '           u.id, u.appointment_id, u.visit_id, null::uuid, u.used_by,\n'
    '           jsonb_build_object(''quantity_used'', u.quantity_used,\n'
    '                              ''package_name'', pk2.name_ar,\n'
    '                              ''reversal_reason'', u.reversal_reason)\n'
    '    from patient_package_usages u\n'
    '    join patient_packages pp2 on pp2.id = u.patient_package_id\n'
    '    join packages pk2 on pk2.id = pp2.package_id\n'
    '    join package_items pi on pi.id = u.package_item_id\n'
    '    join items i on i.id = pi.item_id\n'
    '    where pp2.patient_id = p_patient_id\n'
    '  )');

  if v_new = v_src then
    raise exception 'تعذّر ترقيع الخط الزمني — تغيّر نصّه، وأحداث الباقات لن تظهر في رحلة المريض';
  end if;
  execute v_new;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_sell_package','app_claim_package_coverage',
                             'app_freeze_patient_package','app_resume_patient_package',
                             'app_cancel_patient_package','app_renew_patient_package',
                             'app_transfer_patient_package','app_reverse_package_usage',
                             'app_package_unused_value','app_check_package_eligibility']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة الباقات % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_auto_consume_package') then
    raise exception 'الخصم التلقائي عند تنفيذ الخدمة غير مركَّب';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_usage_per_visit_service') then
    raise exception 'لا حارس ضدّ الخصم المزدوج لنفس الخدمة';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'patient_visit_services'
                    and column_name = 'package_usage_id') then
    raise exception 'الخدمة بلا ربط باستخدام الباقة — ستُفوتَر مرّتين';
  end if;
  if position('package_usage_id' in
        (select pg_get_functiondef(p.oid) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'app_create_invoice_from_visit')) = 0 then
    raise exception 'الفوترة لا تحترم تغطية الباقة — الخدمة المغطّاة ستُحمَّل على المريض';
  end if;
end $$;


-- ==========================================================================
-- [8/11]  0097_purchasing_and_suppliers.sql
--          المشتريات والموردون
-- ==========================================================================

-- ============================================================================
-- 0097 — المرحلة 17: المشتريات والموردون
-- ============================================================================
--
-- **ما كان قائمًا**: `distributors` و`purchase_invoices` وبنودها بتشغيلاتها
-- وصلاحياتها، والفاتورة تُدخل المخزون. أي أن النظام يعرف **الفاتورة** ولا
-- يعرف ما قبلها.
--
-- **ما ينقصه — وهو موضع الخسارة**:
--
--   • لا طلب شراء ولا موافقة: يشتري من يشاء بما يشاء، ويُكتشف الأمر في
--     الفاتورة حين لا يبقى إلا الدفع.
--   • لا أمر شراء: لا مرجع يُقاس عليه المستلَم، فالاستلام بأكثر من المطلوب
--     لا يُكتشف أصلًا.
--   • لا استلام منفصل عن الفوترة: البضاعة تصل اليوم والفاتورة بعد أسبوع،
--     فإمّا يدخل المخزون بلا مستند وإمّا يتأخّر الصرف أسبوعًا.
--   • لا مرتجع مشتريات ولا مصروفات شحن: تكلفة الصنف في الدفاتر أقلّ من
--     تكلفته الحقيقية، فيبدو هامش الربح أكبر ممّا هو.
--   • لا كشف حساب مورد: المستحقّ والمدفوع لا يُعرفان إلا بالجمع اليدويّ.
--
-- **التسلسل المنفَّذ**:
--   طلب شراء → موافقة (حسب القيمة) → أمر شراء → استلام مخزني (جزئي أو كامل)
--   → فاتورة مورد → استحقاق ماليّ → دفع المورد
--
-- **لا حذف**: كل مستند يُلغى بحالة وسبب، ولا يُمحى.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('purchasing.view',        'عرض المشتريات',              'purchasing', 1000),
  ('purchasing.request',     'إنشاء طلب شراء',             'purchasing', 1002),
  ('purchasing.approve',     'اعتماد طلبات الشراء',        'purchasing', 1004),
  ('purchasing.order',       'إصدار أوامر الشراء',         'purchasing', 1006),
  ('purchasing.receive',     'الاستلام المخزني',           'purchasing', 1008),
  ('purchasing.over_receive','الاستلام بأكثر من المطلوب',  'purchasing', 1010),
  ('purchasing.invoice',     'تسجيل فواتير الموردين',      'purchasing', 1012),
  ('purchasing.return',      'مرتجع المشتريات',            'purchasing', 1014),
  ('suppliers.manage',       'إدارة الموردين',             'purchasing', 1016),
  ('suppliers.pay',          'دفع مستحقات الموردين',       'purchasing', 1018)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **الاستلام الزائد صلاحية مستقلّة**، لا تابعة للاستلام: من يستلم ليس من
-- يقرّر قبول فائضٍ لم يُطلب.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('accountant',     'purchasing.view'), ('accountant', 'purchasing.request'),
  ('accountant',     'purchasing.invoice'), ('accountant', 'purchasing.return'),
  ('accountant',     'suppliers.manage'), ('accountant', 'suppliers.pay'),
  ('branch_manager', 'purchasing.view'), ('branch_manager', 'purchasing.request'),
  ('branch_manager', 'purchasing.approve'), ('branch_manager', 'purchasing.order'),
  ('branch_manager', 'purchasing.receive'), ('branch_manager', 'purchasing.over_receive'),
  ('branch_manager', 'purchasing.invoice'), ('branch_manager', 'purchasing.return'),
  ('branch_manager', 'suppliers.manage'), ('branch_manager', 'suppliers.pay'),
  ('pharmacist',     'purchasing.view'), ('pharmacist', 'purchasing.request'),
  ('pharmacist',     'purchasing.receive')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) ملف المورد
-- ===========================================================================
alter table distributors
  add column if not exists legal_name         text,
  add column if not exists commercial_register text,
  add column if not exists bank_name          text,
  add column if not exists bank_iban          text,
  add column if not exists bank_account_name  text,
  add column if not exists payment_terms_days integer not null default 0,
  add column if not exists credit_limit       numeric(14,2),
  add column if not exists allowed_branch_ids uuid[],
  add column if not exists is_archived        boolean not null default false,
  add column if not exists archived_at        timestamptz,
  add column if not exists archived_by        uuid references auth.users(id),
  add column if not exists created_by         uuid references auth.users(id),
  add column if not exists updated_by         uuid references auth.users(id);

comment on column distributors.payment_terms_days is
  'مهلة السداد بالأيام من تاريخ الفاتورة. تُشتقّ منها تواريخ الاستحقاق في كشف الحساب، فلا يُحسب التأخير بالتقدير.';
comment on column distributors.bank_iban is
  'الآيبان للتحويل. **ليس سرًّا** — بيانات تحويلٍ يعرفها المورد نفسه؛ ولا تُحفظ هنا أي بيانات دخول أو مفاتيح.';

-- ===========================================================================
-- 3) قواعد الاعتماد حسب القيمة
-- ===========================================================================
create table if not exists purchase_approval_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  min_amount       numeric(14,2) not null default 0,
  max_amount       numeric(14,2),
  required_role_key text not null,
  approval_level   integer not null default 1,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  constraint purchase_approval_rules_range_check
    check (max_amount is null or max_amount > min_amount)
);

comment on table purchase_approval_rules is
  'دورة موافقات المشتريات حسب القيمة. الشريحة تُحدَّد بحدَّين، والمستوى يسمح بتسلسل موافقات لا موافقةً واحدة.';

alter table purchase_approval_rules enable row level security;

-- ===========================================================================
-- 4) طلب الشراء
-- ===========================================================================
create table if not exists purchase_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  warehouse_id     uuid references warehouses(id),
  request_number   text,
  status           text not null default 'draft'
                     check (status in ('draft','submitted','approved','partially_approved',
                                       'rejected','ordered','cancelled')),
  needed_by        date,
  justification    text,
  estimated_total  numeric(14,2) not null default 0,
  requested_by     uuid references auth.users(id),
  submitted_at     timestamptz,
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  approval_note    text,
  rejected_reason  text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id)
);

create table if not exists purchase_request_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  purchase_request_id uuid not null references purchase_requests(id) on delete cascade,
  item_id             uuid not null references items(id),
  qty_requested       numeric(14,3) not null check (qty_requested > 0),
  qty_approved        numeric(14,3),
  estimated_price     numeric(14,2),
  note                text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_pr_org_status
  on purchase_requests (organization_id, status, created_at desc);
create index if not exists idx_pri_request on purchase_request_items (purchase_request_id);

alter table purchase_requests enable row level security;
alter table purchase_request_items enable row level security;

-- ===========================================================================
-- 5) أمر الشراء
-- ===========================================================================
create table if not exists purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  branch_id           uuid references branches(id),
  warehouse_id        uuid references warehouses(id),
  distributor_id      uuid not null references distributors(id),
  purchase_request_id uuid references purchase_requests(id),
  order_number        text,
  status              text not null default 'draft'
                        check (status in ('draft','sent','partially_received','received',
                                          'invoiced','closed','cancelled')),
  order_date          date not null default current_date,
  expected_date       date,
  payment_terms_days  integer,
  subtotal_amount     numeric(14,2) not null default 0,
  vat_amount          numeric(14,2) not null default 0,
  net_amount          numeric(14,2) not null default 0,
  note                text,
  sent_at             timestamptz,
  closed_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id)
);

create table if not exists purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  item_id           uuid not null references items(id),
  qty_ordered       numeric(14,3) not null check (qty_ordered > 0),
  qty_received      numeric(14,3) not null default 0,
  qty_returned      numeric(14,3) not null default 0,
  unit_price        numeric(14,2) not null default 0,
  discount_amount   numeric(14,2) not null default 0,
  vat_rate          numeric(6,3) not null default 0,
  vat_amount        numeric(14,2) not null default 0,
  net_amount        numeric(14,2) not null default 0,
  request_item_id   uuid references purchase_request_items(id),
  note              text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_po_org_status
  on purchase_orders (organization_id, status, order_date desc);
create index if not exists idx_po_distributor
  on purchase_orders (organization_id, distributor_id, order_date desc);
create index if not exists idx_poi_order on purchase_order_items (purchase_order_id);

alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;

-- ===========================================================================
-- 6) الاستلام المخزني — منفصلٌ عن الفوترة
-- ===========================================================================
--
-- البضاعة تصل قبل الفاتورة عادةً. ربطُ دخول المخزون بالفاتورة يعني إمّا
-- إدخالها بلا مستند وإمّا تعطيل الصرف حتى تصل الفاتورة. الاستلام مستندٌ
-- قائم بذاته، والفاتورة تُبنى عليه.
create table if not exists goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  warehouse_id      uuid not null references warehouses(id),
  purchase_order_id uuid references purchase_orders(id),
  distributor_id    uuid not null references distributors(id),
  receipt_number    text,
  status            text not null default 'draft'
                      check (status in ('draft','posted','cancelled')),
  received_at       timestamptz not null default now(),
  received_by       uuid references auth.users(id),
  delivery_note_ref text,
  note              text,
  posted_at         timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

create table if not exists goods_receipt_items (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  goods_receipt_id       uuid not null references goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid references purchase_order_items(id),
  item_id                uuid not null references items(id),
  qty_received           numeric(14,3) not null check (qty_received > 0),
  free_qty               numeric(14,3) not null default 0,
  unit_cost              numeric(14,2) not null default 0,
  lot_number             text,
  expiry_date            date,
  source_barcode         text,
  lot_id                 uuid references inventory_lots(id),
  over_receipt_approved_by uuid references auth.users(id),
  over_receipt_reason    text,
  note                   text,
  created_at             timestamptz not null default now()
);

create index if not exists idx_gr_org
  on goods_receipts (organization_id, status, received_at desc);
create index if not exists idx_gri_receipt on goods_receipt_items (goods_receipt_id);

alter table goods_receipts enable row level security;
alter table goods_receipt_items enable row level security;

-- ===========================================================================
-- 7) ربط فاتورة المورد بالأمر والاستلام، والمرتجع، والمصروفات
-- ===========================================================================
alter table purchase_invoices
  add column if not exists branch_id         uuid references branches(id),
  add column if not exists purchase_order_id uuid references purchase_orders(id),
  add column if not exists goods_receipt_id  uuid references goods_receipts(id),
  add column if not exists due_date          date,
  add column if not exists status            text not null default 'unpaid',
  add column if not exists paid_amount       numeric(14,2) not null default 0,
  add column if not exists expenses_amount   numeric(14,2) not null default 0,
  add column if not exists cancelled_at      timestamptz,
  add column if not exists cancel_reason     text,
  add column if not exists updated_by        uuid references auth.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_invoices_status_check') then
    alter table purchase_invoices add constraint purchase_invoices_status_check
      check (status in ('unpaid','partial','paid','cancelled'));
  end if;
end $$;

create table if not exists purchase_returns (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  branch_id           uuid references branches(id),
  warehouse_id        uuid not null references warehouses(id),
  distributor_id      uuid not null references distributors(id),
  purchase_invoice_id uuid references purchase_invoices(id),
  goods_receipt_id    uuid references goods_receipts(id),
  return_number       text,
  status              text not null default 'draft'
                        check (status in ('draft','posted','cancelled')),
  reason              text not null,
  subtotal_amount     numeric(14,2) not null default 0,
  vat_amount          numeric(14,2) not null default 0,
  net_amount          numeric(14,2) not null default 0,
  returned_at         timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now()
);

create table if not exists purchase_return_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  purchase_return_id uuid not null references purchase_returns(id) on delete cascade,
  item_id            uuid not null references items(id),
  lot_id             uuid references inventory_lots(id),
  qty_returned       numeric(14,3) not null check (qty_returned > 0),
  unit_cost          numeric(14,2) not null default 0,
  vat_rate           numeric(6,3) not null default 0,
  vat_amount         numeric(14,2) not null default 0,
  net_amount         numeric(14,2) not null default 0,
  receipt_item_id    uuid references goods_receipt_items(id),
  note               text,
  created_at         timestamptz not null default now()
);

alter table purchase_returns enable row level security;
alter table purchase_return_items enable row level security;

-- المصروفات الإضافية: شحن، تخليص، تأمين نقل — تُوزَّع على البنود لتصير
-- التكلفة **تكلفةً واصلة** لا سعر فاتورة.
create table if not exists purchase_expenses (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  purchase_invoice_id uuid references purchase_invoices(id),
  goods_receipt_id    uuid references goods_receipts(id),
  expense_type        text not null
                        check (expense_type in ('shipping','customs','insurance','handling','other')),
  amount              numeric(14,2) not null check (amount > 0),
  allocation_method   text not null default 'by_value'
                        check (allocation_method in ('by_value','by_qty')),
  distributor_id      uuid references distributors(id),
  reference_number    text,
  note                text,
  is_allocated        boolean not null default false,
  allocated_at        timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

comment on table purchase_expenses is
  'مصروفات الشراء الإضافية. بلا توزيعها تبقى تكلفة الصنف سعرَ الفاتورة فقط، فيبدو هامش الربح أكبر ممّا هو.';

alter table purchase_expenses enable row level security;

-- ===========================================================================
-- 8) الدوال — التسلسل
-- ===========================================================================

-- 8-1) الاعتماد المطلوب لقيمةٍ ما
create or replace function app_required_approval_role(
  p_organization_id uuid,
  p_amount          numeric,
  p_branch_id       uuid default null
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.required_role_key
    from purchase_approval_rules r
   where r.organization_id = p_organization_id
     and r.is_active
     and (r.branch_id is null or r.branch_id = p_branch_id)
     and coalesce(p_amount, 0) >= r.min_amount
     and (r.max_amount is null or coalesce(p_amount, 0) <= r.max_amount)
   order by r.approval_level desc, r.branch_id nulls last
   limit 1;
$$;

-- 8-2) تقديم الطلب
create or replace function app_submit_purchase_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r     purchase_requests%rowtype;
  v_total numeric;
  v_n     int;
begin
  select * into v_r from purchase_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.request') then
    raise exception 'صلاحيتك لا تسمح بتقديم طلبات الشراء (purchasing.request)';
  end if;
  if v_r.status <> 'draft' then
    raise exception 'لا يُقدَّم طلب حالته %', v_r.status;
  end if;

  select count(*), coalesce(sum(qty_requested * coalesce(estimated_price, 0)), 0)
    into v_n, v_total
    from purchase_request_items where purchase_request_id = p_request_id;
  if v_n = 0 then raise exception 'الطلب بلا بنود'; end if;

  update purchase_requests
     set status = 'submitted', submitted_at = now(),
         estimated_total = v_total, updated_at = now(), updated_by = auth.uid()
   where id = p_request_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'update',
          p_request_id, 'طلب شراء',
          format('قُدّم الطلب بقيمة تقديرية %s', v_total));
end $$;

-- 8-3) الاعتماد — **بالقيمة ودورها**، وبكمّيات قد تقلّ عن المطلوب
create or replace function app_approve_purchase_request(
  p_request_id uuid,
  p_note       text default null,
  p_lines      jsonb default null   -- [{request_item_id, qty_approved}]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r        purchase_requests%rowtype;
  v_role     text;
  v_my_role  text;
  v_line     jsonb;
  v_any_cut  boolean := false;
begin
  select * into v_r from purchase_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد طلبات الشراء (purchasing.approve)';
  end if;
  if v_r.status <> 'submitted' then
    raise exception 'لا يُعتمد طلب حالته %', v_r.status;
  end if;

  -- **مقدّم الطلب لا يعتمده**. فصلُ الطلب عن الاعتماد هو كلّ قيمة الدورة.
  if v_r.requested_by is not null and v_r.requested_by = auth.uid() then
    raise exception 'لا يعتمد الطلبَ مقدّمُه — يلزم معتمِد آخر';
  end if;

  -- دور الاعتماد المطلوب لهذه القيمة
  v_role := app_required_approval_role(v_r.organization_id, v_r.estimated_total, v_r.branch_id);
  if v_role is not null then
    select role_key into v_my_role from organization_memberships
     where organization_id = v_r.organization_id and user_id = auth.uid() and is_active;
    if coalesce(v_my_role, '') <> v_role and not app_is_org_admin(v_r.organization_id) then
      raise exception 'قيمة الطلب (%) تتطلّب اعتماد دور %', v_r.estimated_total, v_role;
    end if;
  end if;

  if p_lines is not null then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      update purchase_request_items
         set qty_approved = least((v_line->>'qty_approved')::numeric, qty_requested)
       where id = (v_line->>'request_item_id')::uuid
         and purchase_request_id = p_request_id;
    end loop;
  end if;

  -- ما لم يُذكر يُعتمد كاملًا
  update purchase_request_items
     set qty_approved = qty_requested
   where purchase_request_id = p_request_id and qty_approved is null;

  select exists (select 1 from purchase_request_items
                  where purchase_request_id = p_request_id
                    and coalesce(qty_approved, 0) < qty_requested)
    into v_any_cut;

  update purchase_requests
     set status = case when v_any_cut then 'partially_approved' else 'approved' end,
         approved_by = auth.uid(), approved_at = now(), approval_note = p_note,
         updated_at = now(), updated_by = auth.uid()
   where id = p_request_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'update',
          p_request_id, 'اعتماد طلب شراء',
          case when v_any_cut then 'اعتماد جزئي' else 'اعتماد كامل' end, p_note);
end $$;

create or replace function app_reject_purchase_request(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_r purchase_requests%rowtype;
begin
  select * into v_r from purchase_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.approve') then
    raise exception 'صلاحيتك لا تسمح برفض طلبات الشراء (purchasing.approve)';
  end if;
  if v_r.status <> 'submitted' then
    raise exception 'لا يُرفض طلب حالته %', v_r.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الرفض مطلوب'; end if;

  update purchase_requests
     set status = 'rejected', rejected_reason = p_reason,
         approved_by = auth.uid(), approved_at = now(),
         updated_at = now(), updated_by = auth.uid()
   where id = p_request_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'update',
          p_request_id, 'رفض طلب شراء', 'رُفض الطلب', p_reason);
end $$;

-- 8-4) أمر الشراء من طلب معتمَد
create or replace function app_create_purchase_order(
  p_request_id     uuid,
  p_distributor_id uuid,
  p_expected_date  date default null,
  p_note           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r     purchase_requests%rowtype;
  v_dist  distributors%rowtype;
  v_po    uuid;
  v_line  record;
  v_sub   numeric := 0;
  v_vat   numeric := 0;
  v_tax   record;
  v_n     int := 0;
begin
  select * into v_r from purchase_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.order') then
    raise exception 'صلاحيتك لا تسمح بإصدار أوامر الشراء (purchasing.order)';
  end if;

  -- **أمرٌ من طلبٍ معتمَد فقط.** بلا هذا تُصبح دورة الموافقة زينةً تُتخطّى.
  if v_r.status not in ('approved','partially_approved') then
    raise exception 'لا يُصدَر أمر شراء من طلب حالته % — يلزم اعتماده أوّلًا', v_r.status;
  end if;

  select * into v_dist from distributors where id = p_distributor_id;
  if v_dist.id is null then raise exception 'المورد غير موجود'; end if;
  if coalesce(v_dist.is_disabled, false) or coalesce(v_dist.is_archived, false) then
    raise exception 'المورد معطَّل أو مؤرشف';
  end if;
  if v_dist.allowed_branch_ids is not null
     and array_length(v_dist.allowed_branch_ids, 1) > 0
     and v_r.branch_id is not null
     and not (v_r.branch_id = any(v_dist.allowed_branch_ids)) then
    raise exception 'المورد لا يتعامل مع هذا الفرع';
  end if;

  insert into purchase_orders (organization_id, branch_id, warehouse_id, distributor_id,
                               purchase_request_id, status, expected_date,
                               payment_terms_days, note, created_by)
  values (v_r.organization_id, v_r.branch_id, v_r.warehouse_id, p_distributor_id,
          p_request_id, 'draft', p_expected_date,
          v_dist.payment_terms_days, p_note, auth.uid())
  returning id into v_po;

  for v_line in
    select ri.*, i.name_ar
      from purchase_request_items ri
      join items i on i.id = ri.item_id
     where ri.purchase_request_id = p_request_id
       and coalesce(ri.qty_approved, 0) > 0
  loop
    -- الضريبة من نفس مصدر المرحلة 12، لا بحساب محلّيّ
    select t.vat_rate, t.vat_amount into v_tax
      from app_compute_line_tax(v_r.organization_id, v_line.item_id, null,
                                coalesce(v_line.estimated_price, 0),
                                v_line.qty_approved, 0) t;

    insert into purchase_order_items (organization_id, purchase_order_id, item_id,
                                      qty_ordered, unit_price, vat_rate, vat_amount,
                                      net_amount, request_item_id)
    values (v_r.organization_id, v_po, v_line.item_id,
            v_line.qty_approved, coalesce(v_line.estimated_price, 0),
            coalesce(v_tax.vat_rate, 0), coalesce(v_tax.vat_amount, 0),
            round(coalesce(v_line.estimated_price, 0) * v_line.qty_approved, 2)
              + coalesce(v_tax.vat_amount, 0),
            v_line.id);

    v_sub := v_sub + round(coalesce(v_line.estimated_price, 0) * v_line.qty_approved, 2);
    v_vat := v_vat + coalesce(v_tax.vat_amount, 0);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'لا بنود معتمَدة في الطلب'; end if;

  update purchase_orders
     set subtotal_amount = v_sub, vat_amount = v_vat, net_amount = v_sub + v_vat
   where id = v_po;

  update purchase_requests set status = 'ordered', updated_at = now()
   where id = p_request_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'add', v_po,
          'أمر شراء', format('أمر بقيمة %s لدى %s', v_sub + v_vat,
                             coalesce(v_dist.name_ar, '')));

  return v_po;
end $$;

-- 8-5) الاستلام — جزئيّ أو كامل، ومنع الزائد إلا بصلاحية
create or replace function app_post_goods_receipt(p_receipt_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gr      goods_receipts%rowtype;
  v_line    record;
  v_lot     uuid;
  v_ordered numeric;
  v_already numeric;
  v_n       int := 0;
begin
  select * into v_gr from goods_receipts where id = p_receipt_id for update;
  if v_gr.id is null then raise exception 'مستند الاستلام غير موجود'; end if;
  if not app_has_permission(v_gr.organization_id, 'purchasing.receive') then
    raise exception 'صلاحيتك لا تسمح بالاستلام المخزني (purchasing.receive)';
  end if;
  if v_gr.status <> 'draft' then
    raise exception 'مستند الاستلام حالته % — لا يُرحَّل مرّتين', v_gr.status;
  end if;

  for v_line in
    select gri.*, i.track_expiry, i.name_ar
      from goods_receipt_items gri
      join items i on i.id = gri.item_id
     where gri.goods_receipt_id = p_receipt_id
  loop
    -- **الاستلام الزائد**: يُقاس على الأمر، ويحتاج صلاحيةً وسببًا.
    if v_line.purchase_order_item_id is not null then
      select poi.qty_ordered, poi.qty_received into v_ordered, v_already
        from purchase_order_items poi where poi.id = v_line.purchase_order_item_id;

      if v_already + v_line.qty_received > v_ordered then
        if not app_has_permission(v_gr.organization_id, 'purchasing.over_receive') then
          raise exception
            'الاستلام يتجاوز المطلوب للصنف %: المطلوب %, المستلَم سابقًا %, الآن % — يلزم صلاحية purchasing.over_receive',
            v_line.name_ar, v_ordered, v_already, v_line.qty_received;
        end if;
        if coalesce(trim(v_line.over_receipt_reason), '') = '' then
          raise exception 'الاستلام الزائد للصنف % بلا سبب مسجَّل', v_line.name_ar;
        end if;
      end if;
    end if;

    -- صنفٌ يُتتبَّع بالصلاحية لا يدخل بلا تاريخ صلاحية
    if coalesce(v_line.track_expiry, false) and v_line.expiry_date is null then
      raise exception 'الصنف % يُتتبَّع بالصلاحية ولا يدخل بلا تاريخ انتهاء', v_line.name_ar;
    end if;
    if v_line.expiry_date is not null and v_line.expiry_date <= current_date then
      raise exception 'الصنف % منتهٍ أو ينتهي اليوم — لا يُستلَم', v_line.name_ar;
    end if;

    -- **الرصيد يُترك صفرًا**: `app_apply_inventory_movement` هو من يزيده عند
    -- ترحيل الحركة. تعبئته هنا كانت تضاعف الكمّية — الخطأ الذي عالجته 0040
    -- سابقًا لفواتير الشراء، وكان سيتكرّر هنا حرفيًّا.
    insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                                expiry_date, qty_received, qty_remaining, unit_cost,
                                distributor_id, received_at, created_by)
    values (v_gr.organization_id, v_gr.warehouse_id, v_line.item_id,
            v_line.lot_number, v_line.expiry_date,
            v_line.qty_received + coalesce(v_line.free_qty, 0),
            0,
            -- المجّانيّ يخفض تكلفة الوحدة: خمسون علبة بسعر أربعين تكلفتها
            -- الحقيقية أقلّ، وتجاهله يرفع التكلفة الدفترية بلا سبب.
            case when v_line.qty_received + coalesce(v_line.free_qty, 0) > 0
                 then round(v_line.unit_cost * v_line.qty_received
                            / (v_line.qty_received + coalesce(v_line.free_qty, 0)), 4)
                 else v_line.unit_cost end,
            v_gr.distributor_id, v_gr.received_at, auth.uid())
    returning id into v_lot;

    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty, unit_price, total_amount,
                                     note, created_by)
    values (v_gr.organization_id, v_gr.warehouse_id, v_line.item_id, v_lot,
            'purchase_in', v_line.qty_received + coalesce(v_line.free_qty, 0),
            v_line.unit_cost,
            round(v_line.unit_cost * v_line.qty_received, 2),
            format('استلام %s', coalesce(v_gr.receipt_number, '')), auth.uid());

    update goods_receipt_items set lot_id = v_lot where id = v_line.id;

    if v_line.purchase_order_item_id is not null then
      update purchase_order_items
         set qty_received = qty_received + v_line.qty_received
       where id = v_line.purchase_order_item_id;
    end if;

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'مستند الاستلام بلا بنود'; end if;

  update goods_receipts
     set status = 'posted', posted_at = now(), updated_at = now()
   where id = p_receipt_id;

  -- حالة الأمر تُشتقّ من المستلَم لا تُكتب يدويًّا
  if v_gr.purchase_order_id is not null then
    update purchase_orders po
       set status = case
             when not exists (select 1 from purchase_order_items poi
                               where poi.purchase_order_id = po.id
                                 and poi.qty_received < poi.qty_ordered)
               then 'received' else 'partially_received' end,
           updated_at = now()
     where po.id = v_gr.purchase_order_id
       and po.status in ('draft','sent','partially_received');
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_gr.organization_id, v_gr.branch_id, auth.uid(), 'purchasing', 'update',
          p_receipt_id, 'استلام مخزني', format('رُحّل %s بندًا إلى المخزون', v_n));

  return v_n;
end $$;

-- 8-6) فاتورة المورد من الاستلام
create or replace function app_create_purchase_invoice_from_receipt(
  p_receipt_id     uuid,
  p_invoice_number text,
  p_invoice_date   date default null,
  p_note           text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gr    goods_receipts%rowtype;
  v_dist  distributors%rowtype;
  v_inv   uuid;
  v_line  record;
  v_sub   numeric := 0;
  v_vat   numeric := 0;
  v_tax   record;
  v_date  date;
begin
  select * into v_gr from goods_receipts where id = p_receipt_id;
  if v_gr.id is null then raise exception 'مستند الاستلام غير موجود'; end if;
  if not app_has_permission(v_gr.organization_id, 'purchasing.invoice') then
    raise exception 'صلاحيتك لا تسمح بتسجيل فواتير الموردين (purchasing.invoice)';
  end if;
  if v_gr.status <> 'posted' then
    raise exception 'لا تُفوتَر بضاعة لم تُرحَّل إلى المخزون (حالة الاستلام: %)', v_gr.status;
  end if;
  if exists (select 1 from purchase_invoices where goods_receipt_id = p_receipt_id
              and coalesce(status, 'unpaid') <> 'cancelled') then
    raise exception 'هذا الاستلام مفوتَر سلفًا';
  end if;

  select * into v_dist from distributors where id = v_gr.distributor_id;
  v_date := coalesce(p_invoice_date, current_date);

  insert into purchase_invoices (organization_id, branch_id, distributor_id, warehouse_id,
                                 purchase_order_id, goods_receipt_id, invoice_number,
                                 invoice_date, due_date, payment_term,
                                 supplier_tax_number, vat_enabled, note, created_by)
  values (v_gr.organization_id, v_gr.branch_id, v_gr.distributor_id, v_gr.warehouse_id,
          v_gr.purchase_order_id, p_receipt_id, p_invoice_number,
          v_date,
          v_date + coalesce(v_dist.payment_terms_days, 0),
          -- `payment_term` قائمة مغلقة (نقدًا/آجل) منذ 0003؛ المهلة بالأيام
          -- تعيش في `due_date` لا هنا.
          case when coalesce(v_dist.payment_terms_days, 0) > 0 then 'credit' else 'cash' end,
          v_dist.tax_number, true, p_note, auth.uid())
  returning id into v_inv;

  for v_line in
    select gri.*, i.name_ar
      from goods_receipt_items gri
      join items i on i.id = gri.item_id
     where gri.goods_receipt_id = p_receipt_id
  loop
    select t.vat_rate, t.vat_amount into v_tax
      from app_compute_line_tax(v_gr.organization_id, v_line.item_id, null,
                                v_line.unit_cost, v_line.qty_received, 0) t;

    insert into purchase_invoice_items (purchase_invoice_id, item_id, qty, free_qty,
                                        purchase_price, vat_rate, vat_amount, net_amount,
                                        lot_number, expiry_date, source_barcode)
    values (v_inv, v_line.item_id, v_line.qty_received, v_line.free_qty,
            v_line.unit_cost, coalesce(v_tax.vat_rate, 0), coalesce(v_tax.vat_amount, 0),
            round(v_line.unit_cost * v_line.qty_received, 2) + coalesce(v_tax.vat_amount, 0),
            v_line.lot_number, v_line.expiry_date, v_line.source_barcode);

    v_sub := v_sub + round(v_line.unit_cost * v_line.qty_received, 2);
    v_vat := v_vat + coalesce(v_tax.vat_amount, 0);
  end loop;

  update purchase_invoices
     set subtotal_amount = v_sub, vat_amount = v_vat, net_amount = v_sub + v_vat
   where id = v_inv;

  if v_gr.purchase_order_id is not null then
    update purchase_orders set status = 'invoiced', updated_at = now()
     where id = v_gr.purchase_order_id and status = 'received';
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_gr.organization_id, v_gr.branch_id, auth.uid(), 'purchasing', 'add', v_inv,
          'فاتورة مورد', format('فاتورة %s بقيمة %s', p_invoice_number, v_sub + v_vat));

  return v_inv;
end $$;

-- 8-7) مرتجع المشتريات — يخرج من المخزون بالتشغيلة نفسها
create or replace function app_post_purchase_return(p_return_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r    purchase_returns%rowtype;
  v_line record;
  v_n    int := 0;
  v_sub  numeric := 0;
  v_vat  numeric := 0;
begin
  select * into v_r from purchase_returns where id = p_return_id for update;
  if v_r.id is null then raise exception 'المرتجع غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'purchasing.return') then
    raise exception 'صلاحيتك لا تسمح بمرتجع المشتريات (purchasing.return)';
  end if;
  if v_r.status <> 'draft' then
    raise exception 'المرتجع حالته % — لا يُرحَّل مرّتين', v_r.status;
  end if;
  if coalesce(trim(v_r.reason), '') = '' then raise exception 'سبب المرتجع مطلوب'; end if;

  for v_line in
    select pri.*, i.name_ar, l.qty_remaining, l.unit_cost as lot_cost
      from purchase_return_items pri
      join items i on i.id = pri.item_id
      left join inventory_lots l on l.id = pri.lot_id
     where pri.purchase_return_id = p_return_id
  loop
    -- **لا يُردّ أكثر ممّا في التشغيلة.** الحارس هنا فوق حارس المخزون نفسه
    -- ليعطي رسالةً تخصّ المرتجع بدل رسالة حركةٍ عامّة.
    if v_line.lot_id is not null and v_line.qty_returned > coalesce(v_line.qty_remaining, 0) then
      raise exception 'مرتجع الصنف % يتجاوز رصيد التشغيلة (المتاح %)',
        v_line.name_ar, coalesce(v_line.qty_remaining, 0);
    end if;

    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty, unit_price, total_amount,
                                     note, created_by)
    values (v_r.organization_id, v_r.warehouse_id, v_line.item_id, v_line.lot_id,
            'return_out', v_line.qty_returned,
            coalesce(nullif(v_line.unit_cost, 0), v_line.lot_cost, 0),
            round(coalesce(nullif(v_line.unit_cost, 0), v_line.lot_cost, 0)
                  * v_line.qty_returned, 2),
            format('مرتجع مشتريات: %s', v_r.reason), auth.uid());

    if v_line.receipt_item_id is not null then
      update purchase_order_items poi
         set qty_returned = poi.qty_returned + v_line.qty_returned
        from goods_receipt_items gri
       where gri.id = v_line.receipt_item_id
         and poi.id = gri.purchase_order_item_id;
    end if;

    v_sub := v_sub + round(coalesce(nullif(v_line.unit_cost, 0), v_line.lot_cost, 0)
                           * v_line.qty_returned, 2);
    v_vat := v_vat + coalesce(v_line.vat_amount, 0);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'المرتجع بلا بنود'; end if;

  update purchase_returns
     set status = 'posted', posted_at = now(),
         subtotal_amount = v_sub, vat_amount = v_vat, net_amount = v_sub + v_vat,
         updated_at = now()
   where id = p_return_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'purchasing', 'update',
          p_return_id, 'مرتجع مشتريات',
          format('رُدّ %s بندًا بقيمة %s', v_n, v_sub + v_vat), v_r.reason);

  return v_n;
end $$;

-- 8-8) توزيع المصروفات على التكلفة الواصلة
create or replace function app_allocate_purchase_expense(p_expense_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e     purchase_expenses%rowtype;
  v_base  numeric;
  v_line  record;
  v_share numeric;
  v_n     int := 0;
begin
  select * into v_e from purchase_expenses where id = p_expense_id for update;
  if v_e.id is null then raise exception 'المصروف غير موجود'; end if;
  if not app_has_permission(v_e.organization_id, 'purchasing.invoice') then
    raise exception 'صلاحيتك لا تسمح بتوزيع مصروفات الشراء (purchasing.invoice)';
  end if;
  if v_e.is_allocated then raise exception 'المصروف موزَّع سلفًا'; end if;
  if v_e.goods_receipt_id is null then
    raise exception 'المصروف بلا استلام مرتبط — لا يُعرف على أيّ تشغيلات يُوزَّع';
  end if;

  -- الأساس: القيمة أو الكمّية. الشحن يُوزَّع بالكمّية عادةً، والتخليص بالقيمة.
  if v_e.allocation_method = 'by_qty' then
    select sum(qty_received) into v_base
      from goods_receipt_items where goods_receipt_id = v_e.goods_receipt_id;
  else
    select sum(qty_received * unit_cost) into v_base
      from goods_receipt_items where goods_receipt_id = v_e.goods_receipt_id;
  end if;

  if coalesce(v_base, 0) <= 0 then
    raise exception 'أساس التوزيع صفر — لا يمكن توزيع المصروف';
  end if;

  for v_line in
    select gri.*, l.qty_remaining
      from goods_receipt_items gri
      left join inventory_lots l on l.id = gri.lot_id
     where gri.goods_receipt_id = v_e.goods_receipt_id
       and gri.lot_id is not null
  loop
    v_share := v_e.amount
             * case when v_e.allocation_method = 'by_qty'
                    then v_line.qty_received
                    else v_line.qty_received * v_line.unit_cost end
             / v_base;

    -- **تُزاد تكلفة الوحدة في التشغيلة**، فتنتقل إلى تكلفة المبيع لاحقًا
    update inventory_lots
       set unit_cost = round(unit_cost
                             + v_share / nullif(v_line.qty_received
                                                + coalesce(v_line.free_qty, 0), 0), 4),
           updated_at = now()
     where id = v_line.lot_id;

    v_n := v_n + 1;
  end loop;

  update purchase_expenses
     set is_allocated = true, allocated_at = now() where id = p_expense_id;

  if v_e.purchase_invoice_id is not null then
    update purchase_invoices
       set expenses_amount = expenses_amount + v_e.amount, updated_at = now()
     where id = v_e.purchase_invoice_id;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_e.organization_id, auth.uid(), 'purchasing', 'update', p_expense_id,
          'توزيع مصروف شراء',
          format('وُزّع %s على %s تشغيلة بطريقة %s', v_e.amount, v_n, v_e.allocation_method));

  return v_n;
end $$;

-- 8-9) دفع المورد — يستعمل سند الصرف القائم لا جدولًا جديدًا
create or replace function app_pay_supplier_invoice(
  p_invoice_id      uuid,
  p_amount          numeric,
  p_payment_method_value_id uuid,
  p_cash_register_id uuid default null,
  p_reference       text default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv   purchase_invoices%rowtype;
  v_due   numeric;
  v_v     uuid;
begin
  select * into v_inv from purchase_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'فاتورة المورد غير موجودة'; end if;
  if not app_has_permission(v_inv.organization_id, 'suppliers.pay') then
    raise exception 'صلاحيتك لا تسمح بدفع مستحقات الموردين (suppliers.pay)';
  end if;
  if coalesce(v_inv.status, 'unpaid') = 'cancelled' then
    raise exception 'الفاتورة ملغاة';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;

  v_due := coalesce(v_inv.net_amount, 0) - coalesce(v_inv.paid_amount, 0);
  -- **لا دفع فوق المستحقّ.** الزيادة تُخفي إمّا خطأً في الفاتورة وإمّا دفعًا
  -- لفاتورة أخرى، وكلاهما يظهر لاحقًا كفرقٍ لا يُفسَّر.
  if p_amount > v_due + 0.001 then
    raise exception 'المبلغ يتجاوز المستحقّ: المتبقّي %', v_due;
  end if;

  insert into financial_vouchers (organization_id, branch_id, voucher_type, amount,
                                  voucher_date, distributor_id,
                                  payment_method_value_id, cash_register_id,
                                  bank_transfer_ref, description, created_by)
  -- `voucher_type` قائمة مغلقة منذ 0003؛ سداد المورد **مصروف** لا نوعٌ جديد.
  -- إضافة نوع كانت ستُخرج هذه السندات من كل تقرير مصروفات قائم.
  values (v_inv.organization_id, v_inv.branch_id, 'expense', p_amount,
          current_date, v_inv.distributor_id,
          p_payment_method_value_id, p_cash_register_id, p_reference,
          coalesce(p_note, format('سداد فاتورة مورد %s', coalesce(v_inv.invoice_number, ''))),
          auth.uid())
  returning id into v_v;

  update purchase_invoices
     set paid_amount = coalesce(paid_amount, 0) + p_amount,
         status = case
           when coalesce(paid_amount, 0) + p_amount >= coalesce(net_amount, 0) - 0.001
             then 'paid'
           when coalesce(paid_amount, 0) + p_amount > 0 then 'partial'
           else 'unpaid' end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_invoice_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_inv.organization_id, v_inv.branch_id, auth.uid(), 'purchasing', 'add', v_v,
          'سداد مورد', format('سُدّد %s من فاتورة %s', p_amount,
                              coalesce(v_inv.invoice_number, '')));

  return v_v;
end $$;

-- ===========================================================================
-- 9) المناظير
-- ===========================================================================
drop view if exists v_purchase_pipeline;
create view v_purchase_pipeline
with (security_invoker = on) as
select
  po.id                as purchase_order_id,
  po.organization_id,
  po.branch_id,
  br.name              as branch_name,
  po.order_date        as report_date,
  po.order_number,
  po.status,
  po.distributor_id,
  d.name_ar            as supplier_name,
  po.warehouse_id,
  w.name               as warehouse_name,
  po.purchase_request_id,
  pr.request_number,
  pr.status            as request_status,
  po.subtotal_amount,
  po.vat_amount,
  po.net_amount,
  po.expected_date,
  agg.line_count,
  agg.qty_ordered,
  agg.qty_received,
  agg.qty_returned,
  case when coalesce(agg.qty_ordered, 0) > 0
       then round(100.0 * coalesce(agg.qty_received, 0) / agg.qty_ordered, 1) end
                       as received_percent,
  (select count(*) from goods_receipts gr
    where gr.purchase_order_id = po.id and gr.status = 'posted') as receipt_count,
  (select count(*) from purchase_invoices pi2
    where pi2.purchase_order_id = po.id) as invoice_count
from purchase_orders po
left join branches br on br.id = po.branch_id
left join distributors d on d.id = po.distributor_id
left join warehouses w on w.id = po.warehouse_id
left join purchase_requests pr on pr.id = po.purchase_request_id
left join lateral (
  select count(*) as line_count,
         sum(qty_ordered) as qty_ordered,
         sum(qty_received) as qty_received,
         sum(qty_returned) as qty_returned
    from purchase_order_items where purchase_order_id = po.id
) agg on true;

comment on view v_purchase_pipeline is
  'مسار الشراء من الطلب إلى الفاتورة، بنسبة المستلَم من المطلوب — الفجوة بينهما هي ما لم يصل بعد.';

-- `v_supplier_balances` مبنيّ فوقها ويُعاد إنشاؤه في هذا الملف.
drop view if exists v_supplier_ledger cascade;
create view v_supplier_ledger
with (security_invoker = on) as
select
  'invoice'::text      as entry_kind,
  pi.id                as reference_id,
  pi.invoice_number::text as reference_number,
  pi.organization_id,
  pi.branch_id,
  pi.distributor_id,
  d.name_ar            as supplier_name,
  pi.invoice_date      as report_date,
  pi.due_date,
  pi.net_amount        as debit_amount,
  0::numeric           as credit_amount,
  pi.status::text      as status,
  case when pi.due_date is not null and pi.due_date < current_date
            and coalesce(pi.status, 'unpaid') <> 'paid'
       then (current_date - pi.due_date)::integer end as days_overdue
from purchase_invoices pi
join distributors d on d.id = pi.distributor_id
where coalesce(pi.status, 'unpaid') <> 'cancelled'
union all
select
  'payment', v.id, v.voucher_number::text, v.organization_id, v.branch_id,
  v.distributor_id, d.name_ar, v.voucher_date, null::date,
  0::numeric, v.amount, 'paid'::text, null::integer
from financial_vouchers v
join distributors d on d.id = v.distributor_id
where v.distributor_id is not null
  and v.voucher_type = 'expense'
  and coalesce(v.is_void, false) = false
union all
select
  'return', pr.id, pr.return_number::text, pr.organization_id, pr.branch_id,
  pr.distributor_id, d.name_ar, pr.returned_at::date, null::date,
  0::numeric, pr.net_amount, pr.status::text, null::integer
from purchase_returns pr
join distributors d on d.id = pr.distributor_id
where pr.status = 'posted';

comment on view v_supplier_ledger is
  'كشف حساب المورد: الفواتير مدينة، والمدفوعات والمرتجعات دائنة، بتواريخ الاستحقاق وأيّام التأخير.';

drop view if exists v_supplier_balances;
create view v_supplier_balances
with (security_invoker = on) as
select
  d.id                 as distributor_id,
  d.organization_id,
  d.name_ar            as supplier_name,
  d.payment_terms_days,
  d.credit_limit,
  coalesce(sum(l.debit_amount), 0)  as total_invoiced,
  coalesce(sum(l.credit_amount), 0) as total_settled,
  coalesce(sum(l.debit_amount), 0) - coalesce(sum(l.credit_amount), 0) as balance_due,
  coalesce(sum(l.debit_amount) filter (where l.days_overdue is not null), 0) as overdue_amount,
  max(l.days_overdue)  as max_days_overdue,
  count(*) filter (where l.entry_kind = 'invoice') as invoice_count,
  case when d.credit_limit is not null
        and coalesce(sum(l.debit_amount), 0) - coalesce(sum(l.credit_amount), 0)
            > d.credit_limit
       then true else false end as over_credit_limit
from distributors d
left join v_supplier_ledger l on l.distributor_id = d.id
where coalesce(d.is_archived, false) = false
group by d.id, d.organization_id, d.name_ar, d.payment_terms_days, d.credit_limit;

comment on view v_supplier_balances is
  'أرصدة الموردين: المفوتَر والمسدَّد والمستحقّ والمتأخّر، وتجاوز حدّ الائتمان.';

drop view if exists v_pending_receipts;
create view v_pending_receipts
with (security_invoker = on) as
select
  poi.id               as purchase_order_item_id,
  po.id                as purchase_order_id,
  po.organization_id,
  po.branch_id,
  po.order_date        as report_date,
  po.order_number,
  po.expected_date,
  po.distributor_id,
  d.name_ar            as supplier_name,
  po.warehouse_id,
  poi.item_id,
  i.name_ar            as item_name,
  poi.qty_ordered,
  poi.qty_received,
  poi.qty_ordered - poi.qty_received as qty_pending,
  poi.unit_price,
  case when po.expected_date is not null and po.expected_date < current_date
       then current_date - po.expected_date end as days_late
from purchase_order_items poi
join purchase_orders po on po.id = poi.purchase_order_id
join items i on i.id = poi.item_id
left join distributors d on d.id = po.distributor_id
where po.status in ('draft','sent','partially_received')
  and poi.qty_received < poi.qty_ordered;

comment on view v_pending_receipts is
  'ما طُلب ولم يصل، بأيّام التأخير عن الموعد المتوقَّع.';

grant select on v_purchase_pipeline, v_supplier_ledger, v_supplier_balances,
                v_pending_receipts to authenticated;

-- ===========================================================================
-- 10) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['purchase_approval_rules','purchase_requests',
                               'purchase_request_items','purchase_orders',
                               'purchase_order_items','goods_receipts',
                               'goods_receipt_items','purchase_returns',
                               'purchase_return_items','purchase_expenses']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;

    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);
    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);
    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);

    execute format('grant select, insert, update on %I to authenticated', r.t);
  end loop;
end $$;

-- **لا حذف للمستندات المرحَّلة.** الإلغاء حالةٌ وسبب، لا محو.
create or replace function app_block_posted_document_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status in ('posted','received','partially_received','invoiced','closed') then
    raise exception 'المستند المرحَّل لا يُحذف — استخدم الإلغاء بسبب';
  end if;
  return old;
end $$;

do $$
declare r record;
begin
  for r in select unnest(array['goods_receipts','purchase_returns','purchase_orders']) as t
  loop
    execute format('drop trigger if exists trg_block_delete_%1$s on %1$I', r.t);
    execute format($f$
      create trigger trg_block_delete_%1$s
        before delete on %1$I
        for each row execute function app_block_posted_document_delete()
    $f$, r.t);
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_submit_purchase_request','app_approve_purchase_request',
                             'app_reject_purchase_request','app_create_purchase_order',
                             'app_post_goods_receipt','app_create_purchase_invoice_from_receipt',
                             'app_post_purchase_return','app_allocate_purchase_expense',
                             'app_pay_supplier_invoice','app_required_approval_role']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المشتريات % غير موجودة', v_v;
    end if;
  end loop;

  foreach v_v in array array['purchase_requests','purchase_orders','goods_receipts',
                             'purchase_returns','purchase_expenses',
                             'purchase_approval_rules']
  loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = v_v and c.relrowsecurity) then
      raise exception 'جدول المشتريات % بلا RLS', v_v;
    end if;
  end loop;

  if not exists (select 1 from permission_catalog
                  where permission_key = 'purchasing.over_receive') then
    raise exception 'صلاحية الاستلام الزائد غير مسجَّلة';
  end if;
end $$;


-- ==========================================================================
-- [9/11]  0098_advanced_inventory.sql
--          المخزون المتقدّم
-- ==========================================================================

-- ============================================================================
-- 0098 — المرحلة 18: المخزون المتقدم
-- ============================================================================
--
-- **ما كان قائمًا**: مستودعات لكل فرع، وتشغيلات بصلاحياتها، وFEFO، ومنع
-- الرصيد السالب، وحجز الوصفات (0088)، وسجل حركة محميّ من الحذف.
--
-- **ما ينقصه**:
--
--   • `stock_transfers` **جدولٌ لا يقوده أحد**: فيه حالة ومعتمِد، ولا دالّة
--     واحدة تنقله بينها. أي أن التحويل بين الفروع يُسجَّل ولا يُنفَّذ، فيبقى
--     الرصيد في مكانه الأصلي بينما البضاعة في مكانٍ آخر.
--   • لا مواقع داخل المستودع: «أين العلبة» سؤالٌ بلا جواب في مستودعٍ كبير.
--   • لا جرد: الفرق بين الدفتر والواقع لا يُكتشف إلا عند النفاد المفاجئ.
--   • حدّ إعادة الطلب **عامّ على الصنف** (`items.reorder_level`) لا لكل
--     مستودع؛ ومستودع الفرع الصغير لا يحتاج ما يحتاجه المركزيّ.
--   • لا تتبّع من الاستلام حتى الصرف: عند سحب تشغيلة معيبة لا يُعرف أين
--     ذهبت.
--
-- **المبدأ**: كل تغيير في الرصيد يمرّ بـ`inventory_movements`، فلا مسار
-- ثانٍ يعدّل الكمّيات من وراء السجلّ.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('inventory.transfer_request', 'طلب تحويل مخزني',      'inventory', 1100),
  ('inventory.transfer_approve', 'اعتماد التحويل',       'inventory', 1102),
  ('inventory.transfer_ship',    'شحن التحويل',          'inventory', 1104),
  ('inventory.transfer_receive', 'استلام التحويل',       'inventory', 1106),
  ('inventory.count',            'تنفيذ الجرد',          'inventory', 1108),
  ('inventory.count_approve',    'اعتماد تسوية الجرد',   'inventory', 1110),
  ('inventory.settings',         'إعدادات حدود المخزون', 'inventory', 1112)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **الجرد والاعتماد لا يجتمعان في دور واحد افتراضيًّا**: من يعدّ ليس من
-- يقرّ الفرق، وإلا صار العجز يُغطّى بقلم مَن سبّبه.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('pharmacist',     'inventory.transfer_request'), ('pharmacist', 'inventory.transfer_ship'),
  ('pharmacist',     'inventory.transfer_receive'), ('pharmacist', 'inventory.count'),
  ('branch_manager', 'inventory.transfer_request'), ('branch_manager', 'inventory.transfer_approve'),
  ('branch_manager', 'inventory.transfer_ship'), ('branch_manager', 'inventory.transfer_receive'),
  ('branch_manager', 'inventory.count'), ('branch_manager', 'inventory.count_approve'),
  ('branch_manager', 'inventory.settings'),
  ('accountant',     'inventory.count_approve'), ('accountant', 'inventory.settings')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) المواقع داخل المستودع
-- ===========================================================================
create table if not exists warehouse_locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  warehouse_id    uuid not null references warehouses(id) on delete cascade,
  code            text not null,
  name            text,
  location_type   text not null default 'shelf'
                    check (location_type in ('aisle','shelf','bin','fridge','freezer','quarantine')),
  parent_location_id uuid references warehouse_locations(id),
  temperature_controlled boolean not null default false,
  is_disabled     boolean not null default false,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_warehouse_location_code
  on warehouse_locations (warehouse_id, code);

comment on table warehouse_locations is
  'مواقع التخزين داخل المستودع. `quarantine` موقعٌ للحجر: التالف والمنتهي يُنقل إليه فلا يُصرف بالخطأ وهو ما زال في الرصيد.';

alter table warehouse_locations enable row level security;

alter table inventory_lots
  add column if not exists location_id uuid references warehouse_locations(id);

-- **الموقع يجب أن يكون في نفس المستودع.** تشغيلةٌ في مستودع أ وموقعها في
-- مستودع ب تعني جردًا لا يُطابق أبدًا.
create or replace function app_guard_lot_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_wh uuid;
begin
  if new.location_id is null then return new; end if;
  select warehouse_id into v_wh from warehouse_locations where id = new.location_id;
  if v_wh is distinct from new.warehouse_id then
    raise exception 'موقع التخزين لا ينتمي إلى مستودع التشغيلة';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_lot_location on inventory_lots;
create trigger trg_guard_lot_location
  before insert or update of location_id, warehouse_id on inventory_lots
  for each row execute function app_guard_lot_location();

-- ===========================================================================
-- 3) حدود المخزون لكل صنف ومستودع
-- ===========================================================================
create table if not exists item_stock_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  warehouse_id    uuid not null references warehouses(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  min_qty         numeric(14,3) not null default 0,
  max_qty         numeric(14,3),
  reorder_level   numeric(14,3) not null default 0,
  reorder_qty     numeric(14,3),
  lead_time_days  integer,
  preferred_distributor_id uuid references distributors(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  constraint item_stock_settings_range_check
    check (max_qty is null or max_qty >= min_qty)
);

create unique index if not exists uq_item_stock_settings
  on item_stock_settings (warehouse_id, item_id);

comment on table item_stock_settings is
  'حدود المخزون لكل صنف في كل مستودع. `items.reorder_level` عامٌّ على الصنف، ومستودع الفرع الصغير لا يحتاج ما يحتاجه المركزيّ.';

alter table item_stock_settings enable row level security;

-- ===========================================================================
-- 4) التحويل المخزني — دورة كاملة
-- ===========================================================================
alter table stock_transfers
  add column if not exists from_branch_id  uuid references branches(id),
  add column if not exists to_branch_id    uuid references branches(id),
  add column if not exists reason          text,
  add column if not exists requested_at    timestamptz not null default now(),
  add column if not exists approved_at     timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists shipped_at      timestamptz,
  add column if not exists shipped_by      uuid references auth.users(id),
  add column if not exists received_at     timestamptz,
  add column if not exists received_by     uuid references auth.users(id),
  add column if not exists cancelled_at    timestamptz,
  add column if not exists cancel_reason   text,
  add column if not exists created_by      uuid references auth.users(id),
  add column if not exists updated_by      uuid references auth.users(id);

do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'stock_transfers'::regclass and conname like '%status%';
  if v_con is not null then
    execute format('alter table stock_transfers drop constraint %I', v_con);
  end if;
  alter table stock_transfers add constraint stock_transfers_status_check
    check (status in ('draft','requested','approved','rejected','shipped',
                      'received','cancelled'));
end $$;

alter table stock_transfer_items
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists lot_id          uuid references inventory_lots(id),
  add column if not exists qty_shipped     numeric(14,3) not null default 0,
  add column if not exists qty_received    numeric(14,3) not null default 0,
  add column if not exists received_lot_id uuid references inventory_lots(id),
  add column if not exists variance_note   text;

update stock_transfer_items sti
   set organization_id = st.organization_id
  from stock_transfers st
 where sti.transfer_id = st.id and sti.organization_id is null;

comment on column stock_transfer_items.received_lot_id is
  'التشغيلة الناتجة في المستودع المستقبِل. الربط بينها وبين المصدر هو ما يجعل تتبّع الدواء عبر الفروع ممكنًا.';

create index if not exists idx_transfers_status
  on stock_transfers (organization_id, status, requested_at desc);

create or replace function app_approve_stock_transfer(
  p_transfer_id uuid,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_t stock_transfers%rowtype;
begin
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if v_t.id is null then raise exception 'التحويل غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'inventory.transfer_approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد التحويلات (inventory.transfer_approve)';
  end if;
  if v_t.status not in ('draft','requested') then
    raise exception 'لا يُعتمد تحويل حالته %', v_t.status;
  end if;
  -- طالب التحويل لا يعتمده
  if v_t.requested_by is not null and v_t.requested_by = auth.uid() then
    raise exception 'لا يعتمد التحويلَ طالبُه — يلزم معتمِد آخر';
  end if;

  update stock_transfers
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         note = coalesce(p_note, note), updated_at = now(), updated_by = auth.uid()
   where id = p_transfer_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_t.organization_id, v_t.from_branch_id, auth.uid(), 'inventory', 'update',
          p_transfer_id, 'اعتماد تحويل مخزني', 'اعتُمد التحويل');
end $$;

create or replace function app_reject_stock_transfer(
  p_transfer_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_t stock_transfers%rowtype;
begin
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if v_t.id is null then raise exception 'التحويل غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'inventory.transfer_approve') then
    raise exception 'صلاحيتك لا تسمح برفض التحويلات (inventory.transfer_approve)';
  end if;
  if v_t.status not in ('draft','requested') then
    raise exception 'لا يُرفض تحويل حالته %', v_t.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الرفض مطلوب'; end if;

  update stock_transfers
     set status = 'rejected', rejected_reason = p_reason,
         approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = p_transfer_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_t.organization_id, v_t.from_branch_id, auth.uid(), 'inventory', 'update',
          p_transfer_id, 'رفض تحويل مخزني', 'رُفض التحويل', p_reason);
end $$;

-- الشحن: يخرج من المصدر بـFEFO إن لم تُحدَّد التشغيلة
create or replace function app_ship_stock_transfer(p_transfer_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t     stock_transfers%rowtype;
  v_line  record;
  v_lot   record;
  v_need  numeric;
  v_take  numeric;
  v_n     int := 0;
begin
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if v_t.id is null then raise exception 'التحويل غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'inventory.transfer_ship') then
    raise exception 'صلاحيتك لا تسمح بشحن التحويلات (inventory.transfer_ship)';
  end if;
  -- **الشحن بعد الاعتماد فقط**: بلا ذلك تخرج البضاعة من الفرع بلا إذن.
  if v_t.status <> 'approved' then
    raise exception 'لا يُشحن تحويل حالته % — يلزم اعتماده أوّلًا', v_t.status;
  end if;
  if v_t.from_warehouse_id = v_t.to_warehouse_id then
    raise exception 'مستودع المصدر والوجهة واحد';
  end if;

  for v_line in
    select sti.*, i.name_ar
      from stock_transfer_items sti
      join items i on i.id = sti.item_id
     where sti.transfer_id = p_transfer_id
  loop
    v_need := v_line.qty;

    for v_lot in
      -- **الأقرب انتهاءً أوّلًا**، وبعد خصم المحجوز: المحجوز لوصفةٍ ليس متاحًا
      -- للتحويل ولو بدا في الرصيد.
      select l.id, l.qty_remaining - coalesce(l.reserved_quantity, 0) as available,
             l.unit_cost, l.lot_number, l.expiry_date, l.selling_price, l.distributor_id
        from inventory_lots l
       where l.warehouse_id = v_t.from_warehouse_id
         and l.item_id = v_line.item_id
         and l.qty_remaining - coalesce(l.reserved_quantity, 0) > 0
         and (l.expiry_date is null or l.expiry_date > current_date)
         and coalesce(l.status, 'available') = 'available'
         and (v_line.lot_id is null or l.id = v_line.lot_id)
       order by l.expiry_date nulls last, l.received_at
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_lot.available);

      insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                       movement_type, qty, unit_price, total_amount,
                                       related_stock_transfer_id, note, created_by)
      values (v_t.organization_id, v_t.from_warehouse_id, v_line.item_id, v_lot.id,
              'transfer_out', v_take, v_lot.unit_cost,
              round(v_lot.unit_cost * v_take, 2), p_transfer_id,
              format('شحن تحويل %s', coalesce(v_t.transfer_number::text, '')), auth.uid());

      -- التشغيلة المستقبِلة تُنشأ الآن بكمّية صفر، وتُملأ عند الاستلام:
      -- بهذا تبقى البضاعة **خارج رصيد الوجهة** ما دامت في الطريق.
      if v_line.lot_id is null then
        update stock_transfer_items set lot_id = v_lot.id where id = v_line.id;
      end if;

      v_need := v_need - v_take;
    end loop;

    if v_need > 0 then
      raise exception 'رصيد الصنف % لا يكفي للتحويل: ناقص %', v_line.name_ar, v_need;
    end if;

    update stock_transfer_items set qty_shipped = v_line.qty where id = v_line.id;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'التحويل بلا بنود'; end if;

  update stock_transfers
     set status = 'shipped', shipped_at = now(), shipped_by = auth.uid(),
         updated_at = now()
   where id = p_transfer_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_t.organization_id, v_t.from_branch_id, auth.uid(), 'inventory', 'update',
          p_transfer_id, 'شحن تحويل مخزني', format('شُحن %s بندًا', v_n));

  return v_n;
end $$;

-- الاستلام: يدخل الوجهة بتشغيلة جديدة تحمل نفس رقم التشغيلة وتاريخ الصلاحية
create or replace function app_receive_stock_transfer(
  p_transfer_id uuid,
  p_lines       jsonb default null   -- [{item_id, qty_received, variance_note}]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t      stock_transfers%rowtype;
  v_line   record;
  v_src    inventory_lots%rowtype;
  v_new    uuid;
  v_qty    numeric;
  v_note   text;
  v_n      int := 0;
  v_short  boolean := false;
begin
  select * into v_t from stock_transfers where id = p_transfer_id for update;
  if v_t.id is null then raise exception 'التحويل غير موجود'; end if;
  if not app_has_permission(v_t.organization_id, 'inventory.transfer_receive') then
    raise exception 'صلاحيتك لا تسمح باستلام التحويلات (inventory.transfer_receive)';
  end if;
  if v_t.status <> 'shipped' then
    raise exception 'لا يُستلَم تحويل حالته % — يلزم شحنه أوّلًا', v_t.status;
  end if;

  for v_line in
    select sti.*, i.name_ar
      from stock_transfer_items sti
      join items i on i.id = sti.item_id
     where sti.transfer_id = p_transfer_id
  loop
    v_qty  := coalesce((select (e->>'qty_received')::numeric
                          from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
                         where (e->>'item_id')::uuid = v_line.item_id),
                       v_line.qty_shipped);
    v_note := (select e->>'variance_note'
                 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
                where (e->>'item_id')::uuid = v_line.item_id);

    if v_qty > v_line.qty_shipped then
      raise exception 'المستلَم من % يتجاوز المشحون (% > %)',
        v_line.name_ar, v_qty, v_line.qty_shipped;
    end if;
    -- **النقص يحتاج ملاحظة**: فرقٌ بين المشحون والمستلَم بلا تفسير هو فقدٌ
    -- يُدفن في الأرقام.
    if v_qty < v_line.qty_shipped and coalesce(trim(v_note), '') = '' then
      raise exception 'نقص في استلام % بلا ملاحظة تفسّره (شُحن %, استُلم %)',
        v_line.name_ar, v_line.qty_shipped, v_qty;
    end if;
    if v_qty < v_line.qty_shipped then v_short := true; end if;

    select * into v_src from inventory_lots where id = v_line.lot_id;

    insert into inventory_lots (organization_id, warehouse_id, item_id, lot_number,
                                expiry_date, qty_received, qty_remaining, unit_cost,
                                selling_price, distributor_id, received_at, created_by)
    values (v_t.organization_id, v_t.to_warehouse_id, v_line.item_id,
            v_src.lot_number, v_src.expiry_date, v_qty, 0,
            coalesce(nullif(v_line.unit_cost, 0), v_src.unit_cost, 0),
            v_src.selling_price, v_src.distributor_id, now(), auth.uid())
    returning id into v_new;

    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty, unit_price, total_amount,
                                     related_stock_transfer_id, note, created_by)
    values (v_t.organization_id, v_t.to_warehouse_id, v_line.item_id, v_new,
            'transfer_in', v_qty,
            coalesce(nullif(v_line.unit_cost, 0), v_src.unit_cost, 0),
            round(coalesce(nullif(v_line.unit_cost, 0), v_src.unit_cost, 0) * v_qty, 2),
            p_transfer_id,
            format('استلام تحويل %s', coalesce(v_t.transfer_number::text, '')), auth.uid());

    update stock_transfer_items
       set qty_received = v_qty, received_lot_id = v_new,
           variance_note = coalesce(v_note, variance_note)
     where id = v_line.id;

    v_n := v_n + 1;
  end loop;

  update stock_transfers
     set status = 'received', received_at = now(), received_by = auth.uid(),
         updated_at = now()
   where id = p_transfer_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_t.organization_id, v_t.to_branch_id, auth.uid(), 'inventory', 'update',
          p_transfer_id, 'استلام تحويل مخزني',
          format('استُلم %s بندًا%s', v_n,
                 case when v_short then ' — بفروقات موثَّقة' else '' end));

  return v_n;
end $$;

-- ===========================================================================
-- 5) الجرد: دوريّ ومفاجئ، وتسوية بسبب واعتماد
-- ===========================================================================
create table if not exists stock_counts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  warehouse_id    uuid not null references warehouses(id),
  count_number    text,
  count_type      text not null default 'periodic'
                    check (count_type in ('periodic','surprise','partial','annual')),
  status          text not null default 'open'
                    check (status in ('open','counted','approved','posted','cancelled')),
  scope_note      text,
  started_at      timestamptz not null default now(),
  started_by      uuid references auth.users(id),
  counted_at      timestamptz,
  counted_by      uuid references auth.users(id),
  approved_at     timestamptz,
  approved_by     uuid references auth.users(id),
  posted_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists stock_count_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  stock_count_id  uuid not null references stock_counts(id) on delete cascade,
  item_id         uuid not null references items(id),
  lot_id          uuid references inventory_lots(id),
  location_id     uuid references warehouse_locations(id),
  -- **الرصيد الدفتري يُجمَّد لحظة فتح الجرد**، لا يُقرأ عند الترحيل: قراءتُه
  -- لاحقًا تجعل كل صرفٍ وقع أثناء العدّ يظهر عجزًا.
  system_qty      numeric(14,3) not null default 0,
  counted_qty     numeric(14,3),
  variance_qty    numeric(14,3) generated always as
                    (coalesce(counted_qty, 0) - system_qty) stored,
  unit_cost       numeric(14,2) not null default 0,
  variance_reason text,
  counted_at      timestamptz,
  counted_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_stock_counts_wh
  on stock_counts (organization_id, warehouse_id, status);
create index if not exists idx_stock_count_items_count
  on stock_count_items (stock_count_id);

alter table stock_counts enable row level security;
alter table stock_count_items enable row level security;

-- جردٌ مفتوح واحد لكل مستودع: جردان متزامنان يتسويان الفرق نفسه مرّتين
create unique index if not exists uq_one_open_count_per_warehouse
  on stock_counts (warehouse_id)
  where status in ('open','counted','approved');

create or replace function app_start_stock_count(
  p_warehouse_id uuid,
  p_count_type   text default 'periodic',
  p_number       text default null,
  p_item_ids     uuid[] default null,
  p_scope_note   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wh warehouses%rowtype;
  v_id uuid;
  v_n  int;
begin
  select * into v_wh from warehouses where id = p_warehouse_id;
  if v_wh.id is null then raise exception 'المستودع غير موجود'; end if;
  if not app_has_permission(v_wh.organization_id, 'inventory.count') then
    raise exception 'صلاحيتك لا تسمح بتنفيذ الجرد (inventory.count)';
  end if;

  insert into stock_counts (organization_id, branch_id, warehouse_id, count_number,
                            count_type, scope_note, started_by)
  values (v_wh.organization_id, v_wh.branch_id, p_warehouse_id, p_number,
          p_count_type, p_scope_note, auth.uid())
  returning id into v_id;

  -- لقطة الرصيد الدفتري لحظة الفتح
  insert into stock_count_items (organization_id, stock_count_id, item_id, lot_id,
                                 location_id, system_qty, unit_cost)
  select v_wh.organization_id, v_id, l.item_id, l.id, l.location_id,
         l.qty_remaining, l.unit_cost
    from inventory_lots l
   where l.warehouse_id = p_warehouse_id
     and coalesce(l.status, 'available') = 'available'
     and (p_item_ids is null or l.item_id = any(p_item_ids));

  get diagnostics v_n = row_count;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_wh.organization_id, v_wh.branch_id, auth.uid(), 'inventory', 'add', v_id,
          'فتح جرد', format('جرد %s على %s تشغيلة', p_count_type, v_n));

  return v_id;
end $$;

create or replace function app_record_stock_count_line(
  p_count_item_id uuid,
  p_counted_qty   numeric,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ci stock_count_items%rowtype;
  v_c  stock_counts%rowtype;
begin
  select * into v_ci from stock_count_items where id = p_count_item_id for update;
  if v_ci.id is null then raise exception 'بند الجرد غير موجود'; end if;
  select * into v_c from stock_counts where id = v_ci.stock_count_id;
  if not app_has_permission(v_c.organization_id, 'inventory.count') then
    raise exception 'صلاحيتك لا تسمح بتنفيذ الجرد (inventory.count)';
  end if;
  if v_c.status not in ('open','counted') then
    raise exception 'الجرد حالته % — لا يُعدَّل', v_c.status;
  end if;
  if coalesce(p_counted_qty, -1) < 0 then
    raise exception 'الكمّية المعدودة لا تكون سالبة';
  end if;

  -- **الفرق يحتاج سببًا**. جردٌ يُقفل بفروقٍ بلا أسباب لا يُصلح شيئًا؛
  -- يحوّل العجز إلى رقمٍ مقبول.
  if p_counted_qty <> v_ci.system_qty and coalesce(trim(p_reason), '') = '' then
    raise exception 'فرق الجرد (% مقابل %) يحتاج سببًا مسجَّلًا',
      p_counted_qty, v_ci.system_qty;
  end if;

  update stock_count_items
     set counted_qty = p_counted_qty, variance_reason = p_reason,
         counted_at = now(), counted_by = auth.uid()
   where id = p_count_item_id;

  update stock_counts
     set status = 'counted', counted_at = now(), counted_by = auth.uid(),
         updated_at = now()
   where id = v_ci.stock_count_id and status = 'open';
end $$;

create or replace function app_approve_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c stock_counts%rowtype;
  v_uncounted int;
begin
  select * into v_c from stock_counts where id = p_count_id for update;
  if v_c.id is null then raise exception 'الجرد غير موجود'; end if;
  if not app_has_permission(v_c.organization_id, 'inventory.count_approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد تسوية الجرد (inventory.count_approve)';
  end if;
  if v_c.status <> 'counted' then
    raise exception 'لا يُعتمد جرد حالته %', v_c.status;
  end if;
  -- **من عدّ لا يعتمد**: وإلا غُطّي العجز بقلم مَن سبّبه
  if v_c.counted_by is not null and v_c.counted_by = auth.uid() then
    raise exception 'لا يعتمد الجردَ من نفّذه — يلزم معتمِد آخر';
  end if;

  select count(*) into v_uncounted
    from stock_count_items where stock_count_id = p_count_id and counted_qty is null;
  if v_uncounted > 0 then
    raise exception 'بقي % بندًا لم يُعدّ — لا يُعتمد جردٌ ناقص', v_uncounted;
  end if;

  update stock_counts
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         updated_at = now()
   where id = p_count_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_c.organization_id, v_c.branch_id, auth.uid(), 'inventory', 'update',
          p_count_id, 'اعتماد جرد', 'اعتُمدت نتائج الجرد');
end $$;

create or replace function app_post_stock_count(p_count_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c    stock_counts%rowtype;
  v_line record;
  v_n    int := 0;
begin
  select * into v_c from stock_counts where id = p_count_id for update;
  if v_c.id is null then raise exception 'الجرد غير موجود'; end if;
  if not app_has_permission(v_c.organization_id, 'inventory.count_approve') then
    raise exception 'صلاحيتك لا تسمح بترحيل تسوية الجرد (inventory.count_approve)';
  end if;
  -- **الترحيل بعد الاعتماد فقط**: التسوية تغيّر الرصيد، فلا تمرّ بلا إقرار.
  if v_c.status <> 'approved' then
    raise exception 'لا يُرحَّل جرد حالته % — يلزم اعتماده أوّلًا', v_c.status;
  end if;

  for v_line in
    select ci.*, i.name_ar
      from stock_count_items ci
      join items i on i.id = ci.item_id
     where ci.stock_count_id = p_count_id
       and ci.variance_qty <> 0
  loop
    -- التسوية حركةٌ في السجلّ لا تعديلٌ مباشر للرصيد: كل تغيير له أثر
    insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                     movement_type, qty, unit_price, total_amount,
                                     note, created_by)
    values (v_c.organization_id, v_c.warehouse_id, v_line.item_id, v_line.lot_id,
            case when v_line.variance_qty > 0 then 'adjustment_in' else 'adjustment_out' end,
            abs(v_line.variance_qty), v_line.unit_cost,
            round(v_line.unit_cost * abs(v_line.variance_qty), 2),
            format('تسوية جرد %s: %s', coalesce(v_c.count_number::text, ''),
                   coalesce(v_line.variance_reason, 'بلا سبب')),
            auth.uid());
    v_n := v_n + 1;
  end loop;

  update stock_counts
     set status = 'posted', posted_at = now(), updated_at = now()
   where id = p_count_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_c.organization_id, v_c.branch_id, auth.uid(), 'inventory', 'update',
          p_count_id, 'ترحيل تسوية جرد', format('سُوّي %s فرقًا', v_n));

  return v_n;
end $$;

-- ===========================================================================
-- 6) الحجر والإتلاف — بدل الحذف
-- ===========================================================================
create or replace function app_quarantine_lot(
  p_lot_id uuid,
  p_reason text,
  p_location_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_l inventory_lots%rowtype;
begin
  select * into v_l from inventory_lots where id = p_lot_id for update;
  if v_l.id is null then raise exception 'التشغيلة غير موجودة'; end if;
  if not app_has_permission(v_l.organization_id, 'inventory.count') then
    raise exception 'صلاحيتك لا تسمح بحجر التشغيلات (inventory.count)';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الحجر مطلوب'; end if;

  -- **الحجر لا يخرج الكمّية من الرصيد** — يمنع صرفها فقط. الإخراج يكون
  -- بإتلافٍ مسجَّل، وإلا اختفت البضاعة من الدفاتر بلا حركة.
  update inventory_lots
     set status = 'quarantined',
         location_id = coalesce(p_location_id, location_id),
         updated_at = now()
   where id = p_lot_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_l.organization_id, auth.uid(), 'inventory', 'update', p_lot_id,
          'حجر تشغيلة', format('حُجرت التشغيلة %s', coalesce(v_l.lot_number::text, '')), p_reason);
end $$;

create or replace function app_dispose_lot(
  p_lot_id uuid,
  p_qty    numeric,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_l inventory_lots%rowtype;
begin
  select * into v_l from inventory_lots where id = p_lot_id for update;
  if v_l.id is null then raise exception 'التشغيلة غير موجودة'; end if;
  if not app_has_permission(v_l.organization_id, 'inventory.count_approve') then
    raise exception 'صلاحيتك لا تسمح بالإتلاف (inventory.count_approve)';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الإتلاف مطلوب'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'كمّية الإتلاف يجب أن تكون أكبر من صفر'; end if;
  if p_qty > v_l.qty_remaining then
    raise exception 'كمّية الإتلاف تتجاوز رصيد التشغيلة (%)', v_l.qty_remaining;
  end if;

  insert into inventory_movements (organization_id, warehouse_id, item_id, lot_id,
                                   movement_type, qty, unit_price, total_amount,
                                   note, created_by)
  values (v_l.organization_id, v_l.warehouse_id, v_l.item_id, p_lot_id,
          'adjustment_out', p_qty, v_l.unit_cost,
          round(v_l.unit_cost * p_qty, 2),
          format('إتلاف: %s', p_reason), auth.uid());

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_l.organization_id, auth.uid(), 'inventory', 'update', p_lot_id,
          'إتلاف مخزون', format('أُتلف %s من التشغيلة %s', p_qty,
                                coalesce(v_l.lot_number::text, '')), p_reason);
end $$;

-- **الحجر يمنع الصرف**: يُفرض في المُحفِّز لا في الاستعلامات، فلا يفلت
-- مسارٌ نسي شرط الحالة.
create or replace function app_guard_quarantined_lot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  if new.lot_id is null then return new; end if;
  if new.movement_type not in ('sale_out','consumption_out','transfer_out') then
    return new;
  end if;
  select status into v_status from inventory_lots where id = new.lot_id;
  if coalesce(v_status, 'available') = 'quarantined' then
    raise exception 'التشغيلة محجورة — لا تُصرف ولا تُحوَّل حتى يُرفع الحجر';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_quarantined_lot on inventory_movements;
create trigger trg_guard_quarantined_lot
  before insert on inventory_movements
  for each row execute function app_guard_quarantined_lot();

-- ===========================================================================
-- 7) تتبّع الدواء من الاستلام حتى الصرف
-- ===========================================================================
create or replace function app_trace_lot(p_lot_id uuid)
returns table (
  step_order   integer,
  step_kind    text,
  occurred_at  timestamptz,
  warehouse_id uuid,
  qty          numeric,
  reference    text,
  patient_id   uuid,
  created_by   uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_l   inventory_lots%rowtype;
  v_ids uuid[];
begin
  select * into v_l from inventory_lots where id = p_lot_id;
  if v_l.id is null then raise exception 'التشغيلة غير موجودة'; end if;
  if not app_is_member(v_l.organization_id) then
    raise exception 'لا تملك صلاحية على منشأة هذه التشغيلة';
  end if;

  -- **التتبّع يعبر الفروع**: التحويل يُنشئ تشغيلةً جديدة في الوجهة، فلو
  -- اقتصر التتبّع على معرّفٍ واحد لانقطع الخيط عند أوّل تحويل.
  select array_agg(x) into v_ids from (
    select p_lot_id as x
    union
    select sti.received_lot_id from stock_transfer_items sti where sti.lot_id = p_lot_id
    union
    select sti.lot_id from stock_transfer_items sti where sti.received_lot_id = p_lot_id
  ) s where x is not null;

  return query
  select row_number() over (order by m.created_at)::int,
         m.movement_type,
         m.created_at,
         m.warehouse_id,
         m.qty,
         coalesce(m.note, ''),
         m.patient_id,
         m.created_by
    from inventory_movements m
   where m.lot_id = any(v_ids)
   order by m.created_at;
end $$;

-- ===========================================================================
-- 8) المناظير
-- ===========================================================================
drop view if exists v_stock_on_hand_detailed;
create view v_stock_on_hand_detailed
with (security_invoker = on) as
select
  l.id                 as lot_id,
  l.organization_id,
  w.branch_id,
  br.name              as branch_name,
  l.warehouse_id,
  w.name               as warehouse_name,
  l.location_id,
  loc.code             as location_code,
  loc.location_type,
  l.item_id,
  i.name_ar            as item_name,
  i.item_type,
  l.lot_number,
  l.expiry_date,
  l.qty_remaining,
  coalesce(l.reserved_quantity, 0) as reserved_quantity,
  l.qty_remaining - coalesce(l.reserved_quantity, 0) as available_qty,
  l.unit_cost,
  round(l.qty_remaining * l.unit_cost, 2) as stock_value,
  coalesce(l.status, 'available') as lot_status,
  l.received_at        as report_date,
  case when l.expiry_date is not null
       then (l.expiry_date - current_date) end as days_to_expiry,
  (l.expiry_date is not null and l.expiry_date <= current_date) as is_expired
from inventory_lots l
join items i on i.id = l.item_id
join warehouses w on w.id = l.warehouse_id
left join branches br on br.id = w.branch_id
left join warehouse_locations loc on loc.id = l.location_id
where l.qty_remaining > 0;

comment on view v_stock_on_hand_detailed is
  'الرصيد بكل أبعاده: منشأة/فرع/مستودع/موقع/تشغيلة/صلاحية، بالمحجوز والمتاح والقيمة.';

-- `v_stock_movement_age` مبنيّ فوقها ويُعاد إنشاؤه في هذا الملف.
drop view if exists v_stock_valuation cascade;
create view v_stock_valuation
with (security_invoker = on) as
select
  l.organization_id,
  w.branch_id,
  br.name              as branch_name,
  l.warehouse_id,
  w.name               as warehouse_name,
  l.item_id,
  i.name_ar            as item_name,
  i.item_type,
  current_date         as report_date,
  sum(l.qty_remaining) as qty_on_hand,
  sum(coalesce(l.reserved_quantity, 0)) as qty_reserved,
  round(sum(l.qty_remaining * l.unit_cost), 2) as stock_value,
  round(case when sum(l.qty_remaining) > 0
             then sum(l.qty_remaining * l.unit_cost) / sum(l.qty_remaining) end, 4)
                       as weighted_avg_cost,
  min(l.expiry_date)   as earliest_expiry,
  count(*)             as lot_count
from inventory_lots l
join items i on i.id = l.item_id
join warehouses w on w.id = l.warehouse_id
left join branches br on br.id = w.branch_id
where l.qty_remaining > 0 and coalesce(l.status, 'available') = 'available'
group by l.organization_id, w.branch_id, br.name, l.warehouse_id, w.name,
         l.item_id, i.name_ar, i.item_type;

comment on view v_stock_valuation is
  'قيمة المخزون بالتكلفة المرجّحة لكل صنف في كل مستودع. المحجوز ظاهرٌ منفصلًا لأنه مملوك وغير متاح.';

-- الراكد والبطيء: يُقاسان بآخر حركة **خروج**، لا بآخر حركة أيًّا كانت.
-- صنفٌ يُستلم شهريًّا ولا يُصرف أبدًا ليس نشطًا.
drop view if exists v_stock_movement_age;
create view v_stock_movement_age
with (security_invoker = on) as
select
  val.organization_id,
  val.branch_id,
  val.branch_name,
  val.warehouse_id,
  val.warehouse_name,
  val.item_id,
  val.item_name,
  val.report_date,
  val.qty_on_hand,
  val.stock_value,
  mv.last_out_at,
  mv.out_qty_90d,
  case when mv.last_out_at is null then null
       else (current_date - mv.last_out_at::date) end as days_since_last_out,
  case
    when mv.last_out_at is null                                  then 'راكد تمامًا'
    when current_date - mv.last_out_at::date > 180               then 'راكد'
    when current_date - mv.last_out_at::date > 90                then 'بطيء'
    else 'نشط'
  end as movement_class
from v_stock_valuation val
left join lateral (
  select max(m.created_at) as last_out_at,
         sum(m.qty) filter (where m.created_at > now() - interval '90 days') as out_qty_90d
    from inventory_movements m
   where m.item_id = val.item_id
     and m.warehouse_id = val.warehouse_id
     and m.movement_type in ('sale_out','consumption_out','transfer_out')
) mv on true;

comment on view v_stock_movement_age is
  'تصنيف الحركة: نشط/بطيء/راكد — يُقاس بآخر حركة خروج لا بآخر حركة أيًّا كانت، فالاستلام ليس نشاطًا.';

drop view if exists v_reorder_suggestions;
create view v_reorder_suggestions
with (security_invoker = on) as
select
  s.organization_id,
  w.branch_id,
  br.name              as branch_name,
  s.warehouse_id,
  w.name               as warehouse_name,
  s.item_id,
  i.name_ar            as item_name,
  current_date         as report_date,
  s.min_qty,
  s.max_qty,
  s.reorder_level,
  s.reorder_qty,
  s.lead_time_days,
  s.preferred_distributor_id,
  d.name_ar            as preferred_supplier_name,
  coalesce(oh.qty_on_hand, 0)   as qty_on_hand,
  coalesce(oh.qty_reserved, 0)  as qty_reserved,
  coalesce(oh.qty_on_hand, 0) - coalesce(oh.qty_reserved, 0) as available_qty,
  -- الكمّية المقترحة تُكمل إلى الحدّ الأقصى إن وُجد، وإلا فكمّية الطلب المحدَّدة
  greatest(0, coalesce(s.max_qty, coalesce(s.reorder_qty, s.reorder_level))
              - coalesce(oh.qty_on_hand, 0) + coalesce(oh.qty_reserved, 0))
                       as suggested_qty,
  (coalesce(oh.qty_on_hand, 0) - coalesce(oh.qty_reserved, 0) <= s.reorder_level)
                       as needs_reorder,
  (coalesce(oh.qty_on_hand, 0) - coalesce(oh.qty_reserved, 0) < s.min_qty)
                       as below_minimum
from item_stock_settings s
join items i on i.id = s.item_id
join warehouses w on w.id = s.warehouse_id
left join branches br on br.id = w.branch_id
left join distributors d on d.id = s.preferred_distributor_id
left join lateral (
  select sum(l.qty_remaining) as qty_on_hand,
         sum(coalesce(l.reserved_quantity, 0)) as qty_reserved
    from inventory_lots l
   where l.warehouse_id = s.warehouse_id and l.item_id = s.item_id
     and coalesce(l.status, 'available') = 'available'
) oh on true
where s.is_active;

comment on view v_reorder_suggestions is
  'اقتراحات إعادة الطلب بحدود كل مستودع. المتاح = الرصيد ناقص المحجوز، فلا يُطلب صنفٌ رصيده محجوز بالكامل ولا يُترك صنفٌ يبدو موجودًا.';

drop view if exists v_stock_count_variance;
create view v_stock_count_variance
with (security_invoker = on) as
select
  ci.id                as count_item_id,
  c.id                 as stock_count_id,
  c.organization_id,
  c.branch_id,
  c.warehouse_id,
  w.name               as warehouse_name,
  c.count_number,
  c.count_type,
  c.status,
  coalesce(c.posted_at, c.counted_at, c.started_at)::date as report_date,
  ci.item_id,
  i.name_ar            as item_name,
  ci.lot_id,
  l.lot_number,
  l.expiry_date,
  ci.location_id,
  loc.code             as location_code,
  ci.system_qty,
  ci.counted_qty,
  ci.variance_qty,
  ci.unit_cost,
  round(ci.variance_qty * ci.unit_cost, 2) as variance_value,
  ci.variance_reason,
  ci.counted_by,
  c.approved_by
from stock_count_items ci
join stock_counts c on c.id = ci.stock_count_id
join items i on i.id = ci.item_id
join warehouses w on w.id = c.warehouse_id
left join inventory_lots l on l.id = ci.lot_id
left join warehouse_locations loc on loc.id = ci.location_id;

comment on view v_stock_count_variance is
  'فروقات الجرد بقيمتها وسببها ومَن عدّها ومَن اعتمدها.';

drop view if exists v_transfer_pipeline;
create view v_transfer_pipeline
with (security_invoker = on) as
select
  t.id                 as transfer_id,
  t.organization_id,
  t.from_branch_id     as branch_id,
  fb.name              as from_branch_name,
  tb.name              as to_branch_name,
  t.transfer_number::text as transfer_number,
  t.status,
  t.requested_at::date as report_date,
  t.from_warehouse_id,
  fw.name              as from_warehouse_name,
  t.to_warehouse_id,
  tw.name              as to_warehouse_name,
  t.requested_by,
  t.approved_by,
  t.shipped_at,
  t.received_at,
  t.reason,
  t.rejected_reason,
  agg.line_count,
  agg.qty_requested,
  agg.qty_shipped,
  agg.qty_received,
  (coalesce(agg.qty_shipped, 0) - coalesce(agg.qty_received, 0)) as qty_in_transit,
  case when t.shipped_at is not null and t.received_at is not null
       then round(extract(epoch from (t.received_at - t.shipped_at)) / 3600.0, 1) end
                       as transit_hours
from stock_transfers t
left join warehouses fw on fw.id = t.from_warehouse_id
left join warehouses tw on tw.id = t.to_warehouse_id
left join branches fb on fb.id = t.from_branch_id
left join branches tb on tb.id = t.to_branch_id
left join lateral (
  select count(*) as line_count, sum(qty) as qty_requested,
         sum(qty_shipped) as qty_shipped, sum(qty_received) as qty_received
    from stock_transfer_items where transfer_id = t.id
) agg on true;

comment on view v_transfer_pipeline is
  'مسار التحويلات: المطلوب والمشحون والمستلَم، وما هو في الطريق، ومدّة العبور.';

grant select on v_stock_on_hand_detailed, v_stock_valuation, v_stock_movement_age,
                v_reorder_suggestions, v_stock_count_variance, v_transfer_pipeline
  to authenticated;

-- ===========================================================================
-- 9) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['warehouse_locations','item_stock_settings',
                               'stock_counts','stock_count_items']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;
    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);
    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);
    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);
    execute format('grant select, insert, update on %I to authenticated', r.t);
  end loop;
end $$;

-- الجرد المرحَّل لا يُحذف
create or replace function app_block_posted_count_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status in ('approved','posted') then
    raise exception 'الجرد المعتمَد أو المرحَّل لا يُحذف';
  end if;
  return old;
end $$;

drop trigger if exists trg_block_count_delete on stock_counts;
create trigger trg_block_count_delete
  before delete on stock_counts
  for each row execute function app_block_posted_count_delete();

-- ===========================================================================
-- 10) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_approve_stock_transfer','app_reject_stock_transfer',
                             'app_ship_stock_transfer','app_receive_stock_transfer',
                             'app_start_stock_count','app_record_stock_count_line',
                             'app_approve_stock_count','app_post_stock_count',
                             'app_quarantine_lot','app_dispose_lot','app_trace_lot']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المخزون % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_indexes where indexname = 'uq_one_open_count_per_warehouse') then
    raise exception 'لا حارس ضدّ جردين متزامنين على مستودع واحد';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_quarantined_lot') then
    raise exception 'الحجر لا يمنع الصرف — الحارس غير مركَّب';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'stock_count_items' and column_name = 'variance_qty') then
    raise exception 'فرق الجرد غير محسوب';
  end if;
end $$;


-- ==========================================================================
-- [10/11]  0099_general_ledger.sql
--          الأستاذ العام
-- ==========================================================================

-- ============================================================================
-- 0099 — المرحلة 19: المحاسبة العامة
-- ============================================================================
--
-- **ما كان قائمًا** (0017 و0027): دليل حسابات، وقيود ببنودها، وحارس توازن،
-- ومنع تعديل القيد المُرحَّل، وترحيلٌ تلقائيّ من ثلاثة مصادر (فاتورة مبيعات،
-- فاتورة مشتريات، سند ماليّ).
--
-- **ما ينقصه**:
--
--   • **لا سنوات ولا فترات مالية**: لا يوجد إقفال، فيُعدَّل قيدُ شهرٍ صدرت عنه
--     قوائمه وأُقرّت.
--   • **لا مراكز تكلفة ولا بُعد فرع على القيد**: القوائم لا تُقسَّم، فلا يُعرف
--     أيّ فرع يربح وأيّ فرع يخسر.
--   • **لا عكس للقيود**: القيد الخاطئ إمّا يبقى وإمّا يُحذف — والحذف يقطع
--     التسلسل ويُفقد الأثر.
--   • **قواعد الترحيل مدفونة في نصّ الدوال**: تغييرُ حسابٍ يعني تعديل دالّة،
--     والمطلوب — كما نصّ الشرط — أن **تُولَّد القيود من قواعد واضحة**.
--   • لا تسويات بنكية، ولا قائمة دخل، ولا ميزانية، ولا تدفّقات نقدية.
--
-- **الشرط الحاكم المنصوص عليه**: «كل عملية تشغيلية يجب أن تولّد القيد من
-- خلال قواعد ترحيل واضحة، وليس بإضافة القيود يدويًا من الواجهة». لذلك:
-- جدول `gl_posting_rules` يحمل القواعد، و`app_create_manual_journal_entry`
-- يشترط صلاحيةً منفصلة وسببًا، ولا يقبل مرجعًا لعمليةٍ لها قاعدة ترحيل.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('gl.view',           'عرض القيود والقوائم',       'accounting', 1200),
  ('gl.manual_entry',   'إضافة قيد يدويّ',           'accounting', 1202),
  ('gl.post',           'ترحيل القيود',              'accounting', 1204),
  ('gl.reverse',        'عكس القيود المرحَّلة',       'accounting', 1206),
  ('gl.close_period',   'إقفال الفترات المالية',     'accounting', 1208),
  ('gl.reopen_period',  'إعادة فتح فترة مقفلة',      'accounting', 1210),
  ('gl.rules',          'إدارة قواعد الترحيل',       'accounting', 1212),
  ('gl.reconcile',      'التسويات البنكية',          'accounting', 1214),
  ('gl.cost_centers',   'إدارة مراكز التكلفة',       'accounting', 1216)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **إعادة فتح فترة مقفلة لا تُمنح لأحد افتراضيًّا.** إقفالٌ يُفتح بسهولة
-- ليس إقفالًا؛ من يحتاجها يمنحها له مالك المنشأة صراحةً.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('accountant',     'gl.view'), ('accountant', 'gl.manual_entry'),
  ('accountant',     'gl.post'), ('accountant', 'gl.reverse'),
  ('accountant',     'gl.reconcile'), ('accountant', 'gl.cost_centers'),
  ('branch_manager', 'gl.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) السنوات والفترات المالية
-- ===========================================================================
create table if not exists fiscal_years (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  start_date      date not null,
  end_date        date not null,
  status          text not null default 'open'
                    check (status in ('open','closed')),
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  constraint fiscal_years_range_check check (end_date > start_date)
);

-- سنوات لا تتداخل: يومٌ في سنتين يعني قوائم متناقضة لنفس التاريخ
create index if not exists idx_fiscal_years_org on fiscal_years (organization_id, start_date);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_years_no_overlap') then
    alter table fiscal_years add constraint fiscal_years_no_overlap
      exclude using gist (
        organization_id with =,
        daterange(start_date, end_date, '[]') with &&
      );
  end if;
exception when others then
  raise notice 'تعذّر تركيب مانع تداخل السنوات (%) — تحقّق من امتداد btree_gist', sqlerrm;
end $$;

create table if not exists fiscal_periods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  fiscal_year_id  uuid not null references fiscal_years(id) on delete cascade,
  period_number   integer not null check (period_number between 1 and 13),
  name            text,
  start_date      date not null,
  end_date        date not null,
  status          text not null default 'open'
                    check (status in ('open','closed','locked')),
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id),
  reopened_at     timestamptz,
  reopened_by     uuid references auth.users(id),
  reopen_reason   text,
  created_at      timestamptz not null default now(),
  constraint fiscal_periods_range_check check (end_date >= start_date)
);

create unique index if not exists uq_fiscal_period
  on fiscal_periods (fiscal_year_id, period_number);
create index if not exists idx_fiscal_periods_dates
  on fiscal_periods (organization_id, start_date, end_date);

comment on column fiscal_periods.status is
  '`closed` تُقفل الترحيل ويمكن إعادة فتحها بصلاحية وسبب. `locked` نهائيّة — بعد إقفال السنة والتدقيق الخارجيّ لا تُفتح.';

alter table fiscal_years enable row level security;
alter table fiscal_periods enable row level security;

create or replace function app_period_for_date(
  p_organization_id uuid,
  p_date            date
)
returns fiscal_periods
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.* from fiscal_periods p
   where p.organization_id = p_organization_id
     and p_date between p.start_date and p.end_date
   order by p.start_date limit 1;
$$;

-- ===========================================================================
-- 3) مراكز التكلفة وبُعد الفرع
-- ===========================================================================
create table if not exists cost_centers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  code            text not null,
  name_ar         text not null,
  name_en         text,
  center_type     text not null default 'department'
                    check (center_type in ('branch','clinic','department','project','doctor')),
  clinic_id       uuid references clinics(id),
  doctor_id       uuid references doctors(id),
  parent_center_id uuid references cost_centers(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_cost_center_code
  on cost_centers (organization_id, code);

alter table cost_centers enable row level security;

alter table journal_entries
  add column if not exists branch_id        uuid references branches(id),
  add column if not exists fiscal_period_id uuid references fiscal_periods(id),
  add column if not exists posting_rule_id  uuid,
  add column if not exists reversal_of_id   uuid references journal_entries(id),
  add column if not exists reversed_by_id   uuid references journal_entries(id),
  add column if not exists is_manual        boolean not null default false,
  add column if not exists manual_reason    text,
  add column if not exists void_reason      text,
  add column if not exists posted_by        uuid references auth.users(id),
  add column if not exists updated_at       timestamptz not null default now();

alter table journal_entry_lines
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists branch_id       uuid references branches(id),
  add column if not exists cost_center_id  uuid references cost_centers(id),
  add column if not exists line_number     integer;

update journal_entry_lines l
   set organization_id = e.organization_id
  from journal_entries e
 where l.journal_entry_id = e.id and l.organization_id is null;

create index if not exists idx_jel_account
  on journal_entry_lines (account_id);
create index if not exists idx_jel_cost_center
  on journal_entry_lines (cost_center_id) where cost_center_id is not null;
create index if not exists idx_je_period
  on journal_entries (organization_id, entry_date, status);

-- ===========================================================================
-- 4) قواعد الترحيل — القيد يُولَّد منها لا من نصّ الدالّة
-- ===========================================================================
create table if not exists gl_posting_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_key        text not null,
  name_ar         text not null,
  source_event    text not null
                    check (source_event in ('sales_invoice','purchase_invoice','payment_voucher',
                                            'receipt_voucher','refund','payroll','inventory_movement',
                                            'insurance_settlement','stock_adjustment','depreciation')),
  debit_account_id  uuid references chart_of_accounts(id),
  credit_account_id uuid references chart_of_accounts(id),
  amount_expression text not null default 'net_amount',
  condition_note  text,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);

create unique index if not exists uq_gl_rule_key
  on gl_posting_rules (organization_id, rule_key);

comment on table gl_posting_rules is
  'قواعد الترحيل المحاسبيّ: أيّ حدثٍ تشغيليّ يولّد أيّ قيد. **الشرط الحاكم للمرحلة**: القيود تُولَّد من هنا لا تُضاف يدويًّا من الواجهة، وتغيير حسابٍ يكون بتعديل قاعدة لا بتعديل دالّة.';

alter table gl_posting_rules enable row level security;

-- ===========================================================================
-- 5) الحارس: لا ترحيل في فترة مقفلة، ولا تعديل لقيد مُرحَّل
-- ===========================================================================
create or replace function app_guard_fiscal_period()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_p fiscal_periods%rowtype;
begin
  select * into v_p from app_period_for_date(new.organization_id, new.entry_date);

  -- لا فترة معرَّفة: النظام قد يبدأ بلا سنوات مالية، فلا نُعطّل التشغيل.
  -- لكن ما إن تُعرَّف الفترة حتى يصير إقفالها ملزِمًا.
  if v_p.id is null then
    new.updated_at := now();
    return new;
  end if;

  new.fiscal_period_id := v_p.id;

  if v_p.status in ('closed','locked') then
    -- المسوّدة يجوز حفظها في فترة مقفلة، لكن **الترحيل ممنوع**: القوائم صدرت.
    if new.status = 'posted' and (TG_OP = 'INSERT' or coalesce(old.status, '') <> 'posted') then
      raise exception 'الفترة المالية (% إلى %) % — لا يُرحَّل فيها قيد',
        v_p.start_date, v_p.end_date,
        case when v_p.status = 'locked' then 'مقفلة نهائيًّا' else 'مقفلة' end;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_fiscal_period on journal_entries;
create trigger trg_guard_fiscal_period
  before insert or update on journal_entries
  for each row execute function app_guard_fiscal_period();

-- **القيد المرحَّل لا يُحذف ولا يُلغى** — يُعكَس بقيدٍ مضادّ.
create or replace function app_block_posted_entry_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'posted' then
    raise exception 'القيد المرحَّل لا يُحذف — استخدم العكس بقيدٍ مضادّ';
  end if;
  return old;
end $$;

drop trigger if exists trg_block_posted_entry_delete on journal_entries;
create trigger trg_block_posted_entry_delete
  before delete on journal_entries
  for each row execute function app_block_posted_entry_delete();

-- ===========================================================================
-- 6) الدوال
-- ===========================================================================

create or replace function app_close_fiscal_period(
  p_period_id uuid,
  p_lock      boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p     fiscal_periods%rowtype;
  v_draft int;
begin
  select * into v_p from fiscal_periods where id = p_period_id for update;
  if v_p.id is null then raise exception 'الفترة غير موجودة'; end if;
  if not app_has_permission(v_p.organization_id, 'gl.close_period') then
    raise exception 'صلاحيتك لا تسمح بإقفال الفترات (gl.close_period)';
  end if;
  if v_p.status = 'locked' then raise exception 'الفترة مقفلة نهائيًّا'; end if;

  -- **لا إقفال وفي الفترة مسوّدات**: قيدٌ لم يُرحَّل يعني معاملةً خارج القوائم.
  select count(*) into v_draft
    from journal_entries
   where organization_id = v_p.organization_id
     and entry_date between v_p.start_date and v_p.end_date
     and status = 'draft';
  if v_draft > 0 then
    raise exception 'في الفترة % قيدًا مسوّدة — رحّلها أو ألغِها قبل الإقفال', v_draft;
  end if;

  update fiscal_periods
     set status = case when p_lock then 'locked' else 'closed' end,
         closed_at = now(), closed_by = auth.uid()
   where id = p_period_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_p.organization_id, auth.uid(), 'accounting', 'update', p_period_id,
          'إقفال فترة مالية',
          format('أُقفلت الفترة %s إلى %s%s', v_p.start_date, v_p.end_date,
                 case when p_lock then ' نهائيًّا' else '' end));
end $$;

create or replace function app_reopen_fiscal_period(
  p_period_id uuid,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_p fiscal_periods%rowtype;
begin
  select * into v_p from fiscal_periods where id = p_period_id for update;
  if v_p.id is null then raise exception 'الفترة غير موجودة'; end if;
  if not app_has_permission(v_p.organization_id, 'gl.reopen_period') then
    raise exception 'صلاحيتك لا تسمح بإعادة فتح الفترات (gl.reopen_period)';
  end if;
  -- المقفلة نهائيًّا لا تُفتح: بعد التدقيق الخارجيّ لا رجعة
  if v_p.status = 'locked' then
    raise exception 'الفترة مقفلة نهائيًّا ولا يمكن إعادة فتحها';
  end if;
  if v_p.status <> 'closed' then raise exception 'الفترة ليست مقفلة'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب إعادة الفتح مطلوب — إعادة الفتح حدثٌ يُدقَّق';
  end if;

  update fiscal_periods
     set status = 'open', reopened_at = now(), reopened_by = auth.uid(),
         reopen_reason = p_reason
   where id = p_period_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_p.organization_id, auth.uid(), 'accounting', 'update', p_period_id,
          'إعادة فتح فترة مالية',
          format('أُعيد فتح %s إلى %s', v_p.start_date, v_p.end_date), p_reason);
end $$;

-- القيد اليدويّ: مسموحٌ بشروط، وممنوعٌ حيث توجد قاعدة ترحيل
create or replace function app_create_manual_journal_entry(
  p_organization_id uuid,
  p_entry_date      date,
  p_description     text,
  p_reason          text,
  p_lines           jsonb,   -- [{account_id, debit, credit, description, cost_center_id, branch_id}]
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_line   jsonb;
  v_debit  numeric := 0;
  v_credit numeric := 0;
  v_n      int := 0;
begin
  if not app_has_permission(p_organization_id, 'gl.manual_entry') then
    raise exception 'صلاحيتك لا تسمح بالقيود اليدوية (gl.manual_entry)';
  end if;
  -- **القيد اليدويّ استثناء يُبرَّر**: القاعدة أن تُولَّد القيود من العمليات.
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب القيد اليدويّ مطلوب — القيود تُولَّد من العمليات، واليدويّ استثناء';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) < 2 then
    raise exception 'القيد يحتاج بندين على الأقل';
  end if;

  insert into journal_entries (organization_id, branch_id, entry_date, description,
                               status, is_manual, manual_reason, created_by)
  values (p_organization_id, p_branch_id, p_entry_date, p_description,
          'draft', true, p_reason, auth.uid())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_n := v_n + 1;
    insert into journal_entry_lines (journal_entry_id, organization_id, account_id,
                                     debit, credit, description, cost_center_id,
                                     branch_id, line_number)
    values (v_id, p_organization_id, (v_line->>'account_id')::uuid,
            coalesce((v_line->>'debit')::numeric, 0),
            coalesce((v_line->>'credit')::numeric, 0),
            v_line->>'description',
            nullif(v_line->>'cost_center_id', '')::uuid,
            coalesce(nullif(v_line->>'branch_id', '')::uuid, p_branch_id),
            v_n);

    v_debit  := v_debit  + coalesce((v_line->>'debit')::numeric, 0);
    v_credit := v_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;

  if round(v_debit, 2) <> round(v_credit, 2) then
    raise exception 'القيد غير متوازن: مدين % ودائن %', v_debit, v_credit;
  end if;
  if round(v_debit, 2) = 0 then
    raise exception 'القيد بقيمة صفر';
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (p_organization_id, p_branch_id, auth.uid(), 'accounting', 'add', v_id,
          'قيد يدويّ', format('قيد بقيمة %s', v_debit), p_reason);

  return v_id;
end $$;

create or replace function app_post_journal_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e      journal_entries%rowtype;
  v_debit  numeric;
  v_credit numeric;
begin
  select * into v_e from journal_entries where id = p_entry_id for update;
  if v_e.id is null then raise exception 'القيد غير موجود'; end if;
  if not app_has_permission(v_e.organization_id, 'gl.post') then
    raise exception 'صلاحيتك لا تسمح بترحيل القيود (gl.post)';
  end if;
  if v_e.status <> 'draft' then
    raise exception 'لا يُرحَّل قيد حالته %', v_e.status;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_debit, v_credit
    from journal_entry_lines where journal_entry_id = p_entry_id;
  if round(v_debit, 2) <> round(v_credit, 2) then
    raise exception 'القيد غير متوازن: مدين % ودائن %', v_debit, v_credit;
  end if;

  -- حارس الفترة يعمل على التحديث فيرفض الترحيل في فترة مقفلة
  update journal_entries
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_entry_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_e.organization_id, v_e.branch_id, auth.uid(), 'accounting', 'update',
          p_entry_id, 'ترحيل قيد', format('رُحّل قيد بقيمة %s', v_debit));
end $$;

-- **العكس بدل الحذف**: قيدٌ مضادّ بنفس التاريخ أو بتاريخ لاحق إن كانت
-- الفترة الأصلية مقفلة — فلا يُفتح إقفالٌ لتصحيح خطأ.
create or replace function app_reverse_journal_entry(
  p_entry_id uuid,
  p_reason   text,
  p_date     date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e    journal_entries%rowtype;
  v_new  uuid;
  v_line record;
  v_p    fiscal_periods%rowtype;
  v_date date;
  v_n    int := 0;
begin
  select * into v_e from journal_entries where id = p_entry_id for update;
  if v_e.id is null then raise exception 'القيد غير موجود'; end if;
  if not app_has_permission(v_e.organization_id, 'gl.reverse') then
    raise exception 'صلاحيتك لا تسمح بعكس القيود (gl.reverse)';
  end if;
  if v_e.status <> 'posted' then
    raise exception 'لا يُعكس قيد حالته % — المسوّدة تُعدَّل أو تُحذف', v_e.status;
  end if;
  if v_e.reversed_by_id is not null then
    raise exception 'القيد معكوس سلفًا';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب العكس مطلوب'; end if;

  v_date := coalesce(p_date, v_e.entry_date);
  select * into v_p from app_period_for_date(v_e.organization_id, v_date);
  -- لو كانت فترة القيد الأصليّ مقفلة، يُعكس في أوّل يومٍ من فترة مفتوحة
  if v_p.id is not null and v_p.status in ('closed','locked') then
    select p.start_date into v_date
      from fiscal_periods p
     where p.organization_id = v_e.organization_id
       and p.status = 'open' and p.start_date > v_p.end_date
     order by p.start_date limit 1;
    if v_date is null then
      raise exception 'فترة القيد مقفلة ولا توجد فترة مفتوحة لاحقة لعكسه فيها';
    end if;
  end if;

  insert into journal_entries (organization_id, branch_id, entry_date, description,
                               status, reference_type, reference_id, reversal_of_id,
                               is_manual, manual_reason, created_by)
  values (v_e.organization_id, v_e.branch_id, v_date,
          format('عكس قيد: %s', coalesce(v_e.description, '')),
          -- `reference_type` قائمة مغلقة منذ 0017؛ العكس يُوسم `manual`
          -- ويُميَّز بـ`reversal_of_id`. توسيع القائمة كان سيُخرج القيود
          -- من كل تقرير يرشّح بالنوع.
          'draft', 'manual', p_entry_id, p_entry_id, false, p_reason, auth.uid())
  returning id into v_new;

  -- المدين يصير دائنًا والعكس
  for v_line in
    select * from journal_entry_lines where journal_entry_id = p_entry_id
     order by coalesce(line_number, 0)
  loop
    v_n := v_n + 1;
    insert into journal_entry_lines (journal_entry_id, organization_id, account_id,
                                     debit, credit, description, cost_center_id,
                                     branch_id, line_number)
    values (v_new, v_e.organization_id, v_line.account_id,
            v_line.credit, v_line.debit,
            format('عكس: %s', coalesce(v_line.description, '')),
            v_line.cost_center_id, v_line.branch_id, v_n);
  end loop;

  update journal_entries set reversed_by_id = v_new where id = p_entry_id;

  perform app_post_journal_entry(v_new);

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_e.organization_id, v_e.branch_id, auth.uid(), 'accounting', 'update',
          p_entry_id, 'عكس قيد', format('عُكس القيد بقيدٍ مضادّ بتاريخ %s', v_date),
          p_reason);

  return v_new;
end $$;

-- ===========================================================================
-- 7) التسويات البنكية
-- ===========================================================================
create table if not exists bank_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  account_id        uuid not null references chart_of_accounts(id),
  statement_date    date not null,
  statement_balance numeric(14,2) not null,
  book_balance      numeric(14,2) not null default 0,
  status            text not null default 'draft'
                      check (status in ('draft','completed')),
  note              text,
  completed_at      timestamptz,
  completed_by      uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create table if not exists bank_reconciliation_lines (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  bank_reconciliation_id uuid not null references bank_reconciliations(id) on delete cascade,
  journal_entry_line_id  uuid references journal_entry_lines(id),
  voucher_id             uuid references financial_vouchers(id),
  amount                 numeric(14,2) not null,
  is_cleared             boolean not null default false,
  cleared_date           date,
  note                   text,
  created_at             timestamptz not null default now()
);

alter table bank_reconciliations enable row level security;
alter table bank_reconciliation_lines enable row level security;

comment on table bank_reconciliations is
  'التسوية البنكية: رصيد الكشف مقابل رصيد الدفاتر، والفرق يُفسَّر بالبنود غير المطابَقة.';

create or replace function app_complete_bank_reconciliation(p_reconciliation_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r     bank_reconciliations%rowtype;
  v_book  numeric;
  v_uncl  numeric;
  v_diff  numeric;
begin
  select * into v_r from bank_reconciliations where id = p_reconciliation_id for update;
  if v_r.id is null then raise exception 'التسوية غير موجودة'; end if;
  if not app_has_permission(v_r.organization_id, 'gl.reconcile') then
    raise exception 'صلاحيتك لا تسمح بالتسويات البنكية (gl.reconcile)';
  end if;
  if v_r.status <> 'draft' then raise exception 'التسوية مكتملة سلفًا'; end if;

  -- رصيد الدفاتر حتى تاريخ الكشف من القيود المرحَّلة وحدها
  select coalesce(sum(l.debit - l.credit), 0) into v_book
    from journal_entry_lines l
    join journal_entries e on e.id = l.journal_entry_id
   where l.account_id = v_r.account_id
     and e.status = 'posted'
     and e.entry_date <= v_r.statement_date;

  select coalesce(sum(amount), 0) into v_uncl
    from bank_reconciliation_lines
   where bank_reconciliation_id = p_reconciliation_id and not is_cleared;

  -- **الفرق يجب أن تفسّره البنود غير المطابَقة**، وإلا فالتسوية لم تسوِّ شيئًا
  v_diff := round(v_r.statement_balance - (v_book - v_uncl), 2);
  if abs(v_diff) > 0.01 then
    raise exception 'التسوية لا تتوازن: فرقٌ غير مفسَّر قدره % (كشف %, دفاتر %, غير مطابَق %)',
      v_diff, v_r.statement_balance, v_book, v_uncl;
  end if;

  update bank_reconciliations
     set status = 'completed', book_balance = v_book,
         completed_at = now(), completed_by = auth.uid()
   where id = p_reconciliation_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'accounting', 'update',
          p_reconciliation_id, 'إتمام تسوية بنكية',
          format('كشف %s، دفاتر %s', v_r.statement_balance, v_book));

  return v_book;
end $$;

-- ===========================================================================
-- 8) القوائم المالية
-- ===========================================================================

-- أساس مشترك: بنود القيود المرحَّلة بأبعادها
-- تُسقَط معها العروض المبنيّة فوقها (قائمة الدخل، الميزانية، التدفق النقدي،
-- أداء مراكز التكلفة) وتُعاد جميعها في هذا الملف نفسه بعد قليل.
drop view if exists v_gl_lines cascade;
create view v_gl_lines
with (security_invoker = on) as
select
  l.id                 as line_id,
  e.id                 as journal_entry_id,
  e.organization_id,
  coalesce(l.branch_id, e.branch_id) as branch_id,
  br.name              as branch_name,
  e.entry_date         as report_date,
  e.entry_number,
  e.status,
  e.reference_type,
  e.reference_id,
  e.is_manual,
  e.reversal_of_id,
  e.fiscal_period_id,
  fp.name              as period_name,
  fp.status            as period_status,
  l.account_id,
  a.code               as account_code,
  a.name_ar            as account_name,
  a.account_type,
  l.cost_center_id,
  cc.code              as cost_center_code,
  cc.name_ar           as cost_center_name,
  l.debit,
  l.credit,
  (l.debit - l.credit) as net_amount,
  l.description
from journal_entry_lines l
join journal_entries e on e.id = l.journal_entry_id
join chart_of_accounts a on a.id = l.account_id
left join branches br on br.id = coalesce(l.branch_id, e.branch_id)
left join cost_centers cc on cc.id = l.cost_center_id
left join fiscal_periods fp on fp.id = e.fiscal_period_id
where e.status = 'posted';

comment on view v_gl_lines is
  'بنود القيود المرحَّلة بأبعادها (فرع/مركز تكلفة/فترة). كل القوائم تُبنى عليه، فلا تتفرّق تعريفات «المُرحَّل».';

drop view if exists v_income_statement;
create view v_income_statement
with (security_invoker = on) as
select
  organization_id,
  branch_id,
  branch_name,
  cost_center_id,
  cost_center_name,
  report_date,
  account_id,
  account_code,
  account_name,
  account_type,
  -- الإيراد دائنٌ بطبعه، فيُعرض موجبًا؛ والمصروف مدينٌ فيُعرض موجبًا أيضًا.
  -- عرضُهما بإشارة الدفاتر يجعل كل إيراد يبدو سالبًا في القائمة.
  case when account_type = 'revenue' then credit - debit else debit - credit end
                       as amount,
  case when account_type = 'revenue' then 'revenue' else 'expense' end as section
from v_gl_lines
where account_type in ('revenue','expense');

comment on view v_income_statement is
  'قائمة الدخل بحبّة البند. الإيراد والمصروف بإشارة موجبة كلاهما، لا بإشارة الدفاتر.';

drop view if exists v_balance_sheet;
create view v_balance_sheet
with (security_invoker = on) as
select
  organization_id,
  branch_id,
  branch_name,
  report_date,
  account_id,
  account_code,
  account_name,
  account_type,
  case when account_type = 'asset' then debit - credit else credit - debit end
                       as amount,
  case account_type
    when 'asset'     then 'الأصول'
    when 'liability' then 'الخصوم'
    else 'حقوق الملكية'
  end                  as section
from v_gl_lines
where account_type in ('asset','liability','equity');

comment on view v_balance_sheet is
  'الميزانية بحبّة البند. الأصول مدينة والخصوم وحقوق الملكية دائنة، وكلّها بإشارة موجبة للعرض.';

drop view if exists v_cost_center_performance;
create view v_cost_center_performance
with (security_invoker = on) as
select
  g.organization_id,
  g.branch_id,
  g.branch_name,
  g.cost_center_id,
  g.cost_center_code,
  g.cost_center_name,
  g.report_date,
  sum(case when g.account_type = 'revenue' then g.credit - g.debit else 0 end) as revenue,
  sum(case when g.account_type = 'expense' then g.debit - g.credit else 0 end) as expense,
  sum(case when g.account_type = 'revenue' then g.credit - g.debit
           when g.account_type = 'expense' then g.debit - g.credit
           else 0 end)                                                          as net_result
from v_gl_lines g
where g.account_type in ('revenue','expense')
group by g.organization_id, g.branch_id, g.branch_name, g.cost_center_id,
         g.cost_center_code, g.cost_center_name, g.report_date;

comment on view v_cost_center_performance is
  'أداء مراكز التكلفة والفروع: إيراد ومصروف وصافٍ — الفرع الذي يخسر يظهر هنا لا في الإجمالي.';

-- التدفّقات النقدية بالطريقة المباشرة: حركة حسابات النقد والبنوك
drop view if exists v_cash_flow;
create view v_cash_flow
with (security_invoker = on) as
select
  g.organization_id,
  g.branch_id,
  g.branch_name,
  g.report_date,
  g.account_id,
  g.account_code,
  g.account_name,
  sum(g.debit)         as cash_in,
  sum(g.credit)        as cash_out,
  sum(g.debit - g.credit) as net_cash_flow,
  count(*)             as entry_count
from v_gl_lines g
where g.account_type = 'asset'
  and (g.account_code like '11%' or g.account_name like '%نقد%'
       or g.account_name like '%بنك%' or g.account_name like '%صندوق%')
group by g.organization_id, g.branch_id, g.branch_name, g.report_date,
         g.account_id, g.account_code, g.account_name;

comment on view v_cash_flow is
  'التدفّق النقدي بالطريقة المباشرة من حركة حسابات النقد والبنوك المرحَّلة.';

drop view if exists v_fiscal_period_status;
create view v_fiscal_period_status
with (security_invoker = on) as
select
  p.id                 as fiscal_period_id,
  p.organization_id,
  null::uuid           as branch_id,
  p.fiscal_year_id,
  y.name               as fiscal_year_name,
  y.status             as year_status,
  p.period_number,
  p.name               as period_name,
  p.start_date         as report_date,
  p.end_date,
  p.status,
  p.closed_at,
  p.reopened_at,
  p.reopen_reason,
  agg.entry_count,
  agg.draft_count,
  agg.total_debit,
  agg.total_credit,
  round(coalesce(agg.total_debit, 0) - coalesce(agg.total_credit, 0), 2) as imbalance
from fiscal_periods p
join fiscal_years y on y.id = p.fiscal_year_id
left join lateral (
  select count(distinct e.id) as entry_count,
         count(distinct e.id) filter (where e.status = 'draft') as draft_count,
         sum(l.debit) filter (where e.status = 'posted')  as total_debit,
         sum(l.credit) filter (where e.status = 'posted') as total_credit
    from journal_entries e
    left join journal_entry_lines l on l.journal_entry_id = e.id
   where e.organization_id = p.organization_id
     and e.entry_date between p.start_date and p.end_date
) agg on true;

comment on view v_fiscal_period_status is
  'حالة الفترات المالية: عدد القيود والمسوّدات والتوازن — المسوّدة قبل الإقفال معاملةٌ خارج القوائم.';

grant select on v_gl_lines, v_income_statement, v_balance_sheet,
                v_cost_center_performance, v_cash_flow, v_fiscal_period_status
  to authenticated;

-- ===========================================================================
-- 9) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['fiscal_years','fiscal_periods','cost_centers',
                               'gl_posting_rules','bank_reconciliations',
                               'bank_reconciliation_lines']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;
    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);
    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);
    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);
    execute format('grant select, insert, update on %I to authenticated', r.t);
  end loop;
end $$;

-- ===========================================================================
-- 10) بذرة قواعد الترحيل من الترحيل التلقائيّ القائم
-- ===========================================================================
--
-- الدوال الثلاث في 0027 تُرحّل فعلًا؛ ما ينقصها أن تكون **معلَنة**. تُسجَّل
-- قواعدها هنا ليراها المحاسب ويعدّل حساباتها، بدل أن تبقى مدفونة في النصّ.
create or replace function app_seed_gl_posting_rules(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
  r   record;
begin
  if not app_has_permission(p_organization_id, 'gl.rules') then
    raise exception 'صلاحيتك لا تسمح بإدارة قواعد الترحيل (gl.rules)';
  end if;

  for r in
    select * from (values
      ('sales_invoice_revenue',  'إيراد فاتورة مبيعات', 'sales_invoice',    'net_amount', 10),
      ('sales_invoice_vat',      'ضريبة مخرجات',        'sales_invoice',    'vat_amount', 20),
      ('purchase_invoice_cost',  'تكلفة فاتورة مشتريات','purchase_invoice', 'net_amount', 30),
      ('purchase_invoice_vat',   'ضريبة مدخلات',        'purchase_invoice', 'vat_amount', 40),
      ('receipt_voucher_cash',   'سند قبض',             'receipt_voucher',  'amount',     50),
      ('payment_voucher_cash',   'سند صرف',             'payment_voucher',  'amount',     60),
      ('refund_entry',           'استرداد للمريض',      'refund',           'amount',     70),
      ('stock_adjustment_entry', 'تسوية مخزون',         'stock_adjustment', 'total_amount', 80),
      ('insurance_settlement',   'تسوية تأمين',         'insurance_settlement', 'amount', 90)
    ) as t(k, n, ev, expr, ord)
  loop
    if not exists (select 1 from gl_posting_rules
                    where organization_id = p_organization_id and rule_key = r.k) then
      insert into gl_posting_rules (organization_id, rule_key, name_ar, source_event,
                                    amount_expression, sort_order, created_by)
      values (p_organization_id, r.k, r.n, r.ev, r.expr, r.ord, auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end $$;

-- ===========================================================================
-- 10.5) ربط القيد المولَّد بقاعدته، وفرعه
-- ===========================================================================
--
-- إعلان القواعد بلا ربطها بالقيود الناتجة يجعلها **وثيقةً لا أثر لها**:
-- يقرأ المحاسب القاعدة ولا يستطيع أن يسأل «أيّ قيدٍ ولّدته هذه القاعدة؟».
-- تُرقَّع الدوال الثلاث القائمة لتختم `posting_rule_id` و`branch_id`.
do $$
declare
  r      record;
  v_src  text;
  v_new  text;
begin
  for r in select * from (values
    ('app_post_sales_invoice_to_gl',    'sales_invoice_revenue'),
    ('app_post_purchase_invoice_to_gl', 'purchase_invoice_cost'),
    ('app_post_voucher_to_gl',          'receipt_voucher_cash')
  ) as t(fn, rule_key)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
    v_src := replace(v_src, chr(13), '');
    continue when v_src is null;
    continue when position('posting_rule_id' in v_src) > 0;

    v_new := replace(v_src,
      'insert into journal_entries (organization_id, entry_date, reference_type, reference_id, status, description)',
      'insert into journal_entries (organization_id, branch_id, posting_rule_id,'
      || ' entry_date, reference_type, reference_id, status, description)');

    v_new := replace(v_new,
      'values (new.organization_id, ',
      'values (new.organization_id,'
      || ' (select b.id from branches b where b.id = new.branch_id),'
      || ' (select gr.id from gl_posting_rules gr'
      || '   where gr.organization_id = new.organization_id'
      || format('     and gr.rule_key = %L and gr.is_active limit 1), ', r.rule_key));

    if v_new = v_src then
      raise notice 'تعذّر ترقيع % — تغيّر نصّها؛ القيد يبقى صحيحًا بلا ربطٍ بقاعدته', r.fn;
      continue;
    end if;

    begin
      execute v_new;
    exception when others then
      raise notice 'ترقيع % فشل (%) — القيد يبقى صحيحًا', r.fn, sqlerrm;
    end;
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_period_for_date','app_close_fiscal_period',
                             'app_reopen_fiscal_period','app_create_manual_journal_entry',
                             'app_post_journal_entry','app_reverse_journal_entry',
                             'app_complete_bank_reconciliation','app_seed_gl_posting_rules']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المحاسبة % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_fiscal_period') then
    raise exception 'حارس الفترة المالية غير مركَّب — سيُرحَّل في فترة مقفلة';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_block_posted_entry_delete') then
    raise exception 'القيد المرحَّل قابل للحذف';
  end if;
  if exists (select 1 from role_default_permissions
              where permission_key = 'gl.reopen_period') then
    raise exception 'إعادة فتح الفترات مُنحت لدور افتراضيًّا — إقفالٌ يُفتح بسهولة ليس إقفالًا';
  end if;
end $$;


-- ==========================================================================
-- [11/11]  0100_hr_and_payroll.sql
--          الموارد البشرية والرواتب
-- ==========================================================================

-- ============================================================================
-- 0100 — المرحلة 20: الموارد البشرية والرواتب
-- ============================================================================
--
-- **ما كان قائمًا** (0019–0024): ملفات الموظفين، والعقود، والحضور بحساب
-- التأخير والانصراف المبكّر، والإجازات بأرصدتها وتحقّقها، وقوالب الورديات
-- وإسنادها.
--
-- **ما ينقصه — وكلّه في مسار الراتب**:
--
--   • **لا دورة راتب إطلاقًا**: `basic_salary` و`housing_allowance` أرقامٌ في
--     ملف الموظف، لا مسير يُحسب ويُعتمد ويُدفع. الراتب يُحسب خارج النظام،
--     فلا قسيمة ولا ملف تحويل ولا قيدٌ محاسبيّ.
--   • لا بدلات ولا استقطاعات معرَّفة: البدل الرابع يعني عمودًا جديدًا في جدول
--     الموظفين، وهو ما لا يحتمله التوسّع.
--   • لا سلف ولا قروض: تُخصم على الورق فتُنسى.
--   • لا عمل إضافي ولا تبديل مناوبات.
--   • **الإجازة لا تُفحص ضدّ جدول الطبيب ولا مواعيده**: يُعتمد للطبيب إجازةٌ
--     وله عشرون موعدًا في تلك الأيام.
--   • لا سجل ترقيات ولا تنقلات، ولا حساب بنكيّ، ولا تنبيه انتهاء وثيقة.
--
-- **المبدأ**: الراتب **يُحسب** من مكوّناته لا يُكتب يدويًّا، والمسير المعتمَد
-- لا يُعدَّل — يُلغى بإلغاء منظَّم يعكس قيده.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('hr.view',            'عرض ملفات الموظفين',       'hr', 1300),
  ('hr.manage',          'إدارة ملفات الموظفين',     'hr', 1302),
  ('hr.attendance',      'إدارة الحضور والورديات',   'hr', 1304),
  ('hr.overtime_approve','اعتماد العمل الإضافي',     'hr', 1306),
  ('hr.leave_approve',   'اعتماد الإجازات',          'hr', 1308),
  ('payroll.view',       'عرض مسيّرات الرواتب',      'hr', 1310),
  ('payroll.run',        'احتساب مسير الرواتب',      'hr', 1312),
  ('payroll.approve',    'اعتماد مسير الرواتب',      'hr', 1314),
  ('payroll.pay',        'صرف الرواتب',              'hr', 1316),
  ('payroll.loans',      'إدارة السلف والقروض',      'hr', 1318)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **من يحتسب لا يعتمد**: الفصل بين الاحتساب والاعتماد هو ما يمنع أن يزيد
-- أحدٌ بندًا في مسيرٍ يعتمده بنفسه.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('accountant',     'hr.view'), ('accountant', 'payroll.view'),
  ('accountant',     'payroll.run'), ('accountant', 'payroll.pay'),
  ('accountant',     'payroll.loans'),
  ('branch_manager', 'hr.view'), ('branch_manager', 'hr.manage'),
  ('branch_manager', 'hr.attendance'), ('branch_manager', 'hr.overtime_approve'),
  ('branch_manager', 'hr.leave_approve'), ('branch_manager', 'payroll.view'),
  ('branch_manager', 'payroll.approve')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) ملف الموظف: البنك والحالة والترقيات
-- ===========================================================================
alter table employees
  add column if not exists bank_name         text,
  add column if not exists bank_iban         text,
  add column if not exists bank_account_name text,
  add column if not exists department_id     uuid,
  add column if not exists job_title         text,
  add column if not exists updated_by        uuid references auth.users(id);

create table if not exists employee_position_history (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  change_type     text not null
                    check (change_type in ('hire','promotion','transfer','salary_change',
                                           'title_change','suspension','termination','reinstatement')),
  effective_date  date not null,
  from_branch_id  uuid references branches(id),
  to_branch_id    uuid references branches(id),
  from_job_title  text,
  to_job_title    text,
  from_salary     numeric(14,2),
  to_salary       numeric(14,2),
  reason          text,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create index if not exists idx_position_history_emp
  on employee_position_history (organization_id, employee_id, effective_date desc);

comment on table employee_position_history is
  'سجل الترقيات والتنقلات وتغيّر الراتب. **يُكتب تلقائيًّا** عند تغيّر الراتب أو الفرع أو المسمّى، فلا يعتمد على تذكّر أحد.';

alter table employee_position_history enable row level security;

-- التغيير يُسجَّل من حيث يقع، لا من نيّة المستخدم
create or replace function app_log_employee_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'UPDATE' then
    if coalesce(new.basic_salary, 0) is distinct from coalesce(old.basic_salary, 0) then
      insert into employee_position_history (organization_id, employee_id, change_type,
                                             effective_date, from_salary, to_salary, created_by)
      values (new.organization_id, new.id, 'salary_change', current_date,
              old.basic_salary, new.basic_salary, auth.uid());
    end if;
    if new.branch_id is distinct from old.branch_id then
      insert into employee_position_history (organization_id, employee_id, change_type,
                                             effective_date, from_branch_id, to_branch_id,
                                             created_by)
      values (new.organization_id, new.id, 'transfer', current_date,
              old.branch_id, new.branch_id, auth.uid());
    end if;
    if coalesce(new.job_title, '') is distinct from coalesce(old.job_title, '') then
      insert into employee_position_history (organization_id, employee_id, change_type,
                                             effective_date, from_job_title, to_job_title,
                                             created_by)
      values (new.organization_id, new.id, 'title_change', current_date,
              old.job_title, new.job_title, auth.uid());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_log_employee_change on employees;
create trigger trg_log_employee_change
  after update of basic_salary, branch_id, job_title on employees
  for each row execute function app_log_employee_change();

-- ===========================================================================
-- 3) مكوّنات الراتب: بدلات واستقطاعات معرَّفة
-- ===========================================================================
create table if not exists salary_components (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code            text not null,
  name_ar         text not null,
  name_en         text,
  component_type  text not null check (component_type in ('allowance','deduction')),
  calculation     text not null default 'fixed'
                    check (calculation in ('fixed','percent_of_basic','percent_of_gross')),
  default_value   numeric(14,4) not null default 0,
  is_taxable      boolean not null default false,
  affects_gosi    boolean not null default false,
  gl_account_id   uuid references chart_of_accounts(id),
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_salary_component_code
  on salary_components (organization_id, code);

create table if not exists employee_salary_components (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  component_id     uuid not null references salary_components(id),
  value            numeric(14,4) not null default 0,
  effective_from   date not null default current_date,
  effective_to     date,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id)
);

create index if not exists idx_emp_components
  on employee_salary_components (employee_id, effective_from);

comment on table salary_components is
  'تعريف البدلات والاستقطاعات. البدل الجديد صفٌّ هنا لا عمودٌ في جدول الموظفين — التوسّع بالبيانات لا بالمخطّط.';

alter table salary_components enable row level security;
alter table employee_salary_components enable row level security;

-- ===========================================================================
-- 4) السلف والقروض
-- ===========================================================================
create table if not exists employee_loans (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  employee_id       uuid not null references employees(id),
  loan_type         text not null default 'advance'
                      check (loan_type in ('advance','loan')),
  amount            numeric(14,2) not null check (amount > 0),
  installment_amount numeric(14,2) not null check (installment_amount > 0),
  installments_count integer not null check (installments_count > 0),
  paid_amount       numeric(14,2) not null default 0,
  start_month       date not null,
  status            text not null default 'active'
                      check (status in ('active','settled','cancelled')),
  reason            text,
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_employee_loans
  on employee_loans (organization_id, employee_id, status);

comment on table employee_loans is
  'السلف والقروض. الخصم يقع في مسير الراتب تلقائيًّا، فلا تُنسى سلفةٌ على الورق.';

alter table employee_loans enable row level security;

-- ===========================================================================
-- 5) العمل الإضافي وتبديل المناوبات
-- ===========================================================================
alter table attendance_records
  add column if not exists branch_id            uuid references branches(id),
  add column if not exists overtime_minutes     integer not null default 0,
  add column if not exists overtime_approved_by uuid references auth.users(id),
  add column if not exists overtime_approved_at timestamptz,
  add column if not exists absence_reason       text;

comment on column attendance_records.overtime_approved_by is
  'العمل الإضافي **لا يُحتسب في الراتب قبل اعتماده**: دقائق مسجَّلة بلا اعتماد ليست مستحقّة.';

create table if not exists shift_swap_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  requester_id      uuid not null references employees(id),
  target_employee_id uuid not null references employees(id),
  swap_date         date not null,
  target_date       date,
  requester_shift_id uuid references shift_templates(id),
  target_shift_id   uuid references shift_templates(id),
  status            text not null default 'pending'
                      check (status in ('pending','accepted','approved','rejected','cancelled')),
  reason            text,
  accepted_at       timestamptz,
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  constraint shift_swap_not_self check (requester_id <> target_employee_id)
);

alter table shift_swap_requests enable row level security;

comment on table shift_swap_requests is
  'تبديل المناوبات: يقبله الزميل أوّلًا ثم يعتمده المسؤول. قبولُ الزميل وحده لا يكفي، واعتماد المسؤول وحده يفرض على زميلٍ لم يوافق.';

-- ===========================================================================
-- 6) الإجازة تُفحص ضدّ جدول الطبيب ومواعيده
-- ===========================================================================
--
-- **هذا أخطر ما في الوحدة**: تُعتمد إجازة لطبيبٍ وله مواعيد مؤكَّدة في تلك
-- الأيام، فيصل المرضى ولا يجدونه. الفحص هنا لا يمنع الإجازة — يمنع
-- **اعتمادها صامتةً**: إمّا تُعالَج المواعيد وإمّا يُسجَّل قرارٌ صريح.
create or replace function app_check_leave_conflicts(
  p_employee_id uuid,
  p_start_date  date,
  p_end_date    date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp     employees%rowtype;
  v_doctor  uuid;
  v_appts   integer := 0;
  v_slots   integer := 0;
  v_blocks  text[] := '{}';
begin
  select * into v_emp from employees where id = p_employee_id;
  if v_emp.id is null then raise exception 'الموظف غير موجود'; end if;

  -- ربط الموظف بالطبيب عبر حساب المستخدم أو رقم الهوية
  select d.id into v_doctor
    from doctors d
   where d.organization_id = v_emp.organization_id
     and ((v_emp.user_id is not null and d.user_id = v_emp.user_id)
       or (v_emp.national_id is not null and d.id_number = v_emp.national_id))
   limit 1;

  if v_doctor is not null then
    select count(*) into v_appts
      from appointments a
     where a.doctor_id = v_doctor
       and a.scheduled_start::date between p_start_date and p_end_date
       and a.status in ('scheduled','confirmed','waiting');
    if v_appts > 0 then
      v_blocks := v_blocks || format('%s موعدًا محجوزًا للطبيب في هذه الفترة', v_appts)::text;
    end if;

    select count(*) into v_slots
      from doctor_working_hours w
     where w.doctor_id = v_doctor;
    if v_slots > 0 then
      v_blocks := v_blocks || 'الطبيب له جدول عمل معتمَد — عطّل أيّامه أو انقل مواعيده'::text;
    end if;
  end if;

  return jsonb_build_object(
    'has_conflicts', array_length(v_blocks, 1) is not null,
    'doctor_id',     v_doctor,
    'appointments',  v_appts,
    'blocks',        to_jsonb(v_blocks));
end $$;

create or replace function app_approve_leave_request(
  p_request_id       uuid,
  p_conflict_note    text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r    leave_requests%rowtype;
  v_conf jsonb;
begin
  select * into v_r from leave_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'طلب الإجازة غير موجود'; end if;
  if not app_has_permission(v_r.organization_id, 'hr.leave_approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد الإجازات (hr.leave_approve)';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'لا يُعتمد طلب حالته %', v_r.status;
  end if;

  v_conf := app_check_leave_conflicts(v_r.employee_id, v_r.start_date, v_r.end_date);
  if (v_conf->>'has_conflicts')::boolean
     and coalesce(trim(p_conflict_note), '') = '' then
    raise exception 'تعارض مع جدول الطبيب أو مواعيده: %. عالِج المواعيد أو سجّل قرارًا صريحًا',
      array_to_string(array(select jsonb_array_elements_text(v_conf->'blocks')), '؛ ');
  end if;

  update leave_requests
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         reason = case when p_conflict_note is not null
                       then coalesce(reason, '') || ' | قرار التعارض: ' || p_conflict_note
                       else reason end,
         updated_at = now()
   where id = p_request_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_r.organization_id, auth.uid(), 'hr', 'update', p_request_id,
          'اعتماد إجازة',
          format('إجازة من %s إلى %s', v_r.start_date, v_r.end_date), p_conflict_note);
end $$;

create or replace function app_approve_shift_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_s shift_swap_requests%rowtype;
begin
  select * into v_s from shift_swap_requests where id = p_swap_id for update;
  if v_s.id is null then raise exception 'طلب التبديل غير موجود'; end if;
  if not app_has_permission(v_s.organization_id, 'hr.attendance') then
    raise exception 'صلاحيتك لا تسمح باعتماد تبديل المناوبات (hr.attendance)';
  end if;
  -- **قبول الزميل شرطٌ للاعتماد**: الاعتماد وحده يفرض مناوبةً على من لم يوافق
  if v_s.status <> 'accepted' then
    raise exception 'لا يُعتمد التبديل قبل قبول الزميل (الحالة %)', v_s.status;
  end if;

  update shift_swap_requests
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_swap_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_s.organization_id, auth.uid(), 'hr', 'update', p_swap_id,
          'اعتماد تبديل مناوبة', format('تبديل بتاريخ %s', v_s.swap_date));
end $$;

-- ===========================================================================
-- 7) دورة الراتب
-- ===========================================================================
create table if not exists payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  run_number        text,
  period_month      date not null,
  status            text not null default 'draft'
                      check (status in ('draft','calculated','approved','paid','cancelled')),
  employee_count    integer not null default 0,
  total_gross       numeric(14,2) not null default 0,
  total_deductions  numeric(14,2) not null default 0,
  total_net         numeric(14,2) not null default 0,
  calculated_at     timestamptz,
  calculated_by     uuid references auth.users(id),
  approved_at       timestamptz,
  approved_by       uuid references auth.users(id),
  paid_at           timestamptz,
  paid_by           uuid references auth.users(id),
  journal_entry_id  uuid references journal_entries(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid references auth.users(id),
  cancel_reason     text,
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

-- مسير واحد لكل شهر وفرع: مسيران يعنيان راتبًا مزدوجًا
create unique index if not exists uq_payroll_run_period
  on payroll_runs (organization_id, period_month, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'cancelled';

create table if not exists payroll_run_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  payroll_run_id    uuid not null references payroll_runs(id) on delete cascade,
  employee_id       uuid not null references employees(id),
  basic_salary      numeric(14,2) not null default 0,
  allowances_total  numeric(14,2) not null default 0,
  overtime_amount   numeric(14,2) not null default 0,
  gross_salary      numeric(14,2) not null default 0,
  absence_deduction numeric(14,2) not null default 0,
  late_deduction    numeric(14,2) not null default 0,
  loan_deduction    numeric(14,2) not null default 0,
  other_deductions  numeric(14,2) not null default 0,
  deductions_total  numeric(14,2) not null default 0,
  net_salary        numeric(14,2) not null default 0,
  worked_days       numeric(6,2),
  absent_days       numeric(6,2),
  late_minutes      integer not null default 0,
  overtime_minutes  integer not null default 0,
  bank_iban         text,
  note              text,
  created_at        timestamptz not null default now()
);

create table if not exists payroll_item_details (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  payroll_run_item_id uuid not null references payroll_run_items(id) on delete cascade,
  component_id        uuid references salary_components(id),
  detail_kind         text not null
                        check (detail_kind in ('basic','allowance','deduction','overtime',
                                               'absence','late','loan')),
  label               text not null,
  amount              numeric(14,2) not null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_payroll_items_run on payroll_run_items (payroll_run_id);
create index if not exists idx_payroll_details_item on payroll_item_details (payroll_run_item_id);

comment on table payroll_item_details is
  'تفصيل كل مبلغ في قسيمة الراتب. قسيمةٌ تعرض إجماليًّا بلا تفصيله لا تُقنع موظّفًا اعترض على رقم.';

alter table payroll_runs enable row level security;
alter table payroll_run_items enable row level security;
alter table payroll_item_details enable row level security;

-- **المسير المعتمَد لا يُعدَّل ولا يُحذف**
create or replace function app_guard_approved_payroll()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  if TG_TABLE_NAME = 'payroll_runs' then
    if TG_OP = 'DELETE' then
      if old.status in ('approved','paid') then
        raise exception 'المسير المعتمَد لا يُحذف — استخدم الإلغاء المنظَّم';
      end if;
      return old;
    end if;
    -- يُسمح بانتقال الحالة نفسها وبالإلغاء، لا بتعديل المبالغ
    if old.status in ('approved','paid')
       and (new.total_net is distinct from old.total_net
         or new.total_gross is distinct from old.total_gross) then
      raise exception 'مبالغ المسير المعتمَد لا تُعدَّل — ألغِه ثم أعد احتسابه';
    end if;
    return new;
  end if;

  select status into v_status from payroll_runs
   where id = coalesce(new.payroll_run_id, old.payroll_run_id);
  if v_status in ('approved','paid') then
    raise exception 'بنود المسير المعتمَد لا تُعدَّل ولا تُحذف';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_guard_approved_payroll on payroll_runs;
create trigger trg_guard_approved_payroll
  before update or delete on payroll_runs
  for each row execute function app_guard_approved_payroll();

drop trigger if exists trg_guard_approved_payroll_items on payroll_run_items;
create trigger trg_guard_approved_payroll_items
  before insert or update or delete on payroll_run_items
  for each row execute function app_guard_approved_payroll();

-- ===========================================================================
-- 8) الاحتساب
-- ===========================================================================
create or replace function app_calculate_payroll_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run     payroll_runs%rowtype;
  v_emp     record;
  v_item    uuid;
  v_start   date;
  v_end     date;
  v_days    integer;
  v_daily   numeric;
  v_allow   numeric;
  v_ot_min  integer;
  v_ot_amt  numeric;
  v_late    integer;
  v_late_amt numeric;
  v_absent  numeric;
  v_abs_amt numeric;
  v_loan    numeric;
  v_gross   numeric;
  v_ded     numeric;
  v_net     numeric;
  v_comp    record;
  v_n       int := 0;
  v_g       numeric := 0;
  v_d       numeric := 0;
  v_nt      numeric := 0;
begin
  select * into v_run from payroll_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.run') then
    raise exception 'صلاحيتك لا تسمح باحتساب الرواتب (payroll.run)';
  end if;
  if v_run.status not in ('draft','calculated') then
    raise exception 'لا يُعاد احتساب مسير حالته %', v_run.status;
  end if;

  v_start := date_trunc('month', v_run.period_month)::date;
  v_end   := (date_trunc('month', v_run.period_month) + interval '1 month - 1 day')::date;
  v_days  := v_end - v_start + 1;

  -- إعادة الاحتساب تمسح النتائج السابقة، لا تُضيف إليها
  delete from payroll_item_details
   where payroll_run_item_id in (select id from payroll_run_items where payroll_run_id = p_run_id);
  delete from payroll_run_items where payroll_run_id = p_run_id;

  for v_emp in
    select e.* from employees e
     where e.organization_id = v_run.organization_id
       and coalesce(e.is_disabled, false) = false
       and coalesce(e.status, 'active') = 'active'
       and (v_run.branch_id is null or e.branch_id = v_run.branch_id)
       -- من عُيّن بعد نهاية الشهر أو انتهت خدمته قبل بدايته ليس في المسير
       and (e.hire_date is null or e.hire_date <= v_end)
       and (e.termination_date is null or e.termination_date >= v_start)
  loop
    v_daily := round(coalesce(v_emp.basic_salary, 0) / nullif(v_days, 0), 4);

    -- البدلات: من المكوّنات المعرَّفة السارية في الشهر
    v_allow := 0;
    -- البدلات القديمة في ملف الموظف تبقى محسوبة حتى تُنقل إلى مكوّنات
    v_allow := v_allow + coalesce(v_emp.housing_allowance, 0)
                       + coalesce(v_emp.transportation_allowance, 0)
                       + coalesce(v_emp.other_allowances, 0);

    -- الحضور
    select coalesce(sum(a.late_minutes), 0),
           coalesce(sum(case when a.overtime_approved_by is not null
                             then a.overtime_minutes else 0 end), 0),
           count(*) filter (where a.status = 'absent')
      into v_late, v_ot_min, v_absent
      from attendance_records a
     where a.employee_id = v_emp.id
       and a.work_date between v_start and v_end;

    -- الإضافيّ بمعامل 1.5 على أجر الساعة، والاعتماد شرطٌ سبق فحصه أعلاه
    v_ot_amt  := round(coalesce(v_ot_min, 0) / 60.0 * (v_daily / 8.0) * 1.5, 2);
    v_late_amt := round(coalesce(v_late, 0) / 60.0 * (v_daily / 8.0), 2);
    v_abs_amt := round(coalesce(v_absent, 0) * v_daily, 2);

    -- قسط السلفة: لا يتجاوز المتبقّي منها
    select coalesce(sum(least(l.installment_amount, l.amount - l.paid_amount)), 0)
      into v_loan
      from employee_loans l
     where l.employee_id = v_emp.id and l.status = 'active'
       and l.start_month <= v_end
       and l.amount > l.paid_amount;

    v_gross := round(coalesce(v_emp.basic_salary, 0) + v_allow + v_ot_amt, 2);

    insert into payroll_run_items (organization_id, payroll_run_id, employee_id,
                                   basic_salary, allowances_total, overtime_amount,
                                   gross_salary, absence_deduction, late_deduction,
                                   loan_deduction, worked_days, absent_days,
                                   late_minutes, overtime_minutes, bank_iban)
    values (v_run.organization_id, p_run_id, v_emp.id,
            coalesce(v_emp.basic_salary, 0), v_allow, v_ot_amt, v_gross,
            v_abs_amt, v_late_amt, v_loan,
            v_days - coalesce(v_absent, 0), coalesce(v_absent, 0),
            coalesce(v_late, 0), coalesce(v_ot_min, 0), v_emp.bank_iban)
    returning id into v_item;

    insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                      label, amount)
    values (v_run.organization_id, v_item, 'basic', 'الراتب الأساسي',
            coalesce(v_emp.basic_salary, 0));
    if v_allow > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'allowance', 'البدلات', v_allow);
    end if;
    if v_ot_amt > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'overtime',
              format('عمل إضافي معتمَد (%s دقيقة)', v_ot_min), v_ot_amt);
    end if;
    if v_abs_amt > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'absence',
              format('غياب %s يومًا', v_absent), -v_abs_amt);
    end if;
    if v_late_amt > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'late',
              format('تأخير %s دقيقة', v_late), -v_late_amt);
    end if;
    if v_loan > 0 then
      insert into payroll_item_details (organization_id, payroll_run_item_id, detail_kind,
                                        label, amount)
      values (v_run.organization_id, v_item, 'loan', 'قسط سلفة', -v_loan);
    end if;

    -- المكوّنات المعرَّفة
    v_ded := 0;
    for v_comp in
      select sc.*, esc.value
        from employee_salary_components esc
        join salary_components sc on sc.id = esc.component_id
       where esc.employee_id = v_emp.id
         and sc.is_active
         and esc.effective_from <= v_end
         and (esc.effective_to is null or esc.effective_to >= v_start)
    loop
      declare v_amt numeric;
      begin
        v_amt := case v_comp.calculation
          when 'percent_of_basic' then round(coalesce(v_emp.basic_salary, 0) * v_comp.value / 100, 2)
          when 'percent_of_gross' then round(v_gross * v_comp.value / 100, 2)
          else v_comp.value
        end;

        insert into payroll_item_details (organization_id, payroll_run_item_id,
                                          component_id, detail_kind, label, amount)
        values (v_run.organization_id, v_item, v_comp.id,
                case when v_comp.component_type = 'allowance' then 'allowance' else 'deduction' end,
                v_comp.name_ar,
                case when v_comp.component_type = 'allowance' then v_amt else -v_amt end);

        if v_comp.component_type = 'allowance' then
          v_allow  := v_allow + v_amt;
          v_gross  := v_gross + v_amt;
        else
          v_ded := v_ded + v_amt;
        end if;
      end;
    end loop;

    v_net := round(v_gross - v_abs_amt - v_late_amt - v_loan - v_ded, 2);

    update payroll_run_items
       set allowances_total = v_allow, gross_salary = v_gross,
           other_deductions = v_ded,
           deductions_total = round(v_abs_amt + v_late_amt + v_loan + v_ded, 2),
           net_salary = v_net
     where id = v_item;

    v_g  := v_g + v_gross;
    v_d  := v_d + v_abs_amt + v_late_amt + v_loan + v_ded;
    v_nt := v_nt + v_net;
    v_n  := v_n + 1;
  end loop;

  update payroll_runs
     set status = 'calculated', employee_count = v_n,
         total_gross = round(v_g, 2), total_deductions = round(v_d, 2),
         total_net = round(v_nt, 2),
         calculated_at = now(), calculated_by = auth.uid(), updated_at = now()
   where id = p_run_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_run_id,
          'احتساب مسير رواتب',
          format('%s موظفًا، إجمالي %s، صافي %s', v_n, round(v_g, 2), round(v_nt, 2)));

  return v_n;
end $$;

create or replace function app_approve_payroll_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run  payroll_runs%rowtype;
  v_bad  int;
begin
  select * into v_run from payroll_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.approve') then
    raise exception 'صلاحيتك لا تسمح باعتماد المسيّرات (payroll.approve)';
  end if;
  if v_run.status <> 'calculated' then
    raise exception 'لا يُعتمد مسير حالته % — احتسبه أوّلًا', v_run.status;
  end if;
  -- **من احتسب لا يعتمد**
  if v_run.calculated_by is not null and v_run.calculated_by = auth.uid() then
    raise exception 'لا يعتمد المسيرَ من احتسبه — يلزم معتمِد آخر';
  end if;

  select count(*) into v_bad from payroll_run_items
   where payroll_run_id = p_run_id and net_salary < 0;
  if v_bad > 0 then
    raise exception '% موظفًا بصافي سالب — راجع الاستقطاعات قبل الاعتماد', v_bad;
  end if;

  update payroll_runs
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         updated_at = now()
   where id = p_run_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_run_id,
          'اعتماد مسير رواتب', format('صافي %s', v_run.total_net));
end $$;

-- الصرف: يخصم أقساط السلف ويولّد القيد المحاسبيّ
create or replace function app_pay_payroll_run(p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run   payroll_runs%rowtype;
  v_item  record;
  v_je    uuid;
  v_exp   uuid;
  v_cash  uuid;
begin
  select * into v_run from payroll_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.pay') then
    raise exception 'صلاحيتك لا تسمح بصرف الرواتب (payroll.pay)';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'لا يُصرف مسير حالته % — يلزم اعتماده', v_run.status;
  end if;

  -- خصم أقساط السلف من أرصدتها
  for v_item in
    select pri.employee_id, pri.loan_deduction
      from payroll_run_items pri
     where pri.payroll_run_id = p_run_id and pri.loan_deduction > 0
  loop
    update employee_loans
       set paid_amount = least(amount, paid_amount + v_item.loan_deduction),
           status = case when least(amount, paid_amount + v_item.loan_deduction) >= amount
                         then 'settled' else status end,
           updated_at = now()
     where employee_id = v_item.employee_id and status = 'active'
       and amount > paid_amount;
  end loop;

  -- القيد المحاسبيّ: مصروف رواتب مدين، النقد دائن
  select id into v_exp from chart_of_accounts
   where organization_id = v_run.organization_id and account_type = 'expense'
     and (code like '51%' or name_ar like '%رواتب%')
   order by code limit 1;
  select id into v_cash from chart_of_accounts
   where organization_id = v_run.organization_id and account_type = 'asset'
     and (code like '11%' or name_ar like '%نقد%' or name_ar like '%بنك%')
   order by code limit 1;

  if v_exp is not null and v_cash is not null and v_run.total_net > 0 then
    insert into journal_entries (organization_id, branch_id, entry_date, reference_type,
                                 reference_id, status, description, created_by)
    values (v_run.organization_id, v_run.branch_id,
            (date_trunc('month', v_run.period_month) + interval '1 month - 1 day')::date,
            'manual', p_run_id, 'draft',
            format('رواتب %s', to_char(v_run.period_month, 'YYYY-MM')), auth.uid())
    returning id into v_je;

    insert into journal_entry_lines (journal_entry_id, organization_id, account_id,
                                     debit, credit, description, branch_id, line_number)
    values (v_je, v_run.organization_id, v_exp, v_run.total_net, 0,
            'مصروف رواتب', v_run.branch_id, 1),
           (v_je, v_run.organization_id, v_cash, 0, v_run.total_net,
            'صرف رواتب', v_run.branch_id, 2);

    -- الترحيل قد يُرفض إن كانت الفترة مقفلة؛ يبقى القيد مسوّدة والصرف قائمًا
    begin
      perform app_post_journal_entry(v_je);
    exception when others then
      raise notice 'تعذّر ترحيل قيد الرواتب (%) — بقي مسوّدة', sqlerrm;
    end;
  end if;

  update payroll_runs
     set status = 'paid', paid_by = auth.uid(), paid_at = now(),
         journal_entry_id = v_je, updated_at = now()
   where id = p_run_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_run_id,
          'صرف رواتب', format('صُرف %s', v_run.total_net));

  return v_je;
end $$;

-- **الإلغاء المنظَّم**: يعكس القيد ويردّ أقساط السلف
create or replace function app_cancel_payroll_run(
  p_run_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run  payroll_runs%rowtype;
  v_item record;
begin
  select * into v_run from payroll_runs where id = p_run_id for update;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.approve') then
    raise exception 'صلاحيتك لا تسمح بإلغاء المسيّرات (payroll.approve)';
  end if;
  if v_run.status = 'cancelled' then raise exception 'المسير ملغى سلفًا'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الإلغاء مطلوب'; end if;

  -- عكس القيد إن كان مرحَّلًا — لا حذفه
  if v_run.journal_entry_id is not null then
    begin
      if (select status from journal_entries where id = v_run.journal_entry_id) = 'posted' then
        perform app_reverse_journal_entry(v_run.journal_entry_id,
                                          format('إلغاء مسير رواتب: %s', p_reason));
      else
        delete from journal_entry_lines where journal_entry_id = v_run.journal_entry_id;
        delete from journal_entries where id = v_run.journal_entry_id;
      end if;
    exception when others then
      raise notice 'تعذّر عكس قيد الرواتب (%) — يلزم عكسه يدويًّا', sqlerrm;
    end;
  end if;

  -- ردّ أقساط السلف المخصومة
  if v_run.status = 'paid' then
    for v_item in
      select employee_id, loan_deduction from payroll_run_items
       where payroll_run_id = p_run_id and loan_deduction > 0
    loop
      update employee_loans
         set paid_amount = greatest(0, paid_amount - v_item.loan_deduction),
             status = case when greatest(0, paid_amount - v_item.loan_deduction) < amount
                           then 'active' else status end,
             updated_at = now()
       where employee_id = v_item.employee_id
         and status in ('active','settled');
    end loop;
  end if;

  update payroll_runs
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = p_reason, updated_at = now()
   where id = p_run_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_run_id,
          'إلغاء مسير رواتب', 'أُلغي المسير وعُكس قيده ورُدّت أقساط السلف', p_reason);
end $$;

-- ملف التحويل البنكيّ
create or replace function app_payroll_bank_file(p_run_id uuid)
returns table (
  employee_name text,
  job_number    text,
  bank_iban     text,
  net_salary    numeric,
  is_ready      boolean,
  issue         text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_run payroll_runs%rowtype;
begin
  select * into v_run from payroll_runs where id = p_run_id;
  if v_run.id is null then raise exception 'المسير غير موجود'; end if;
  if not app_has_permission(v_run.organization_id, 'payroll.pay') then
    raise exception 'صلاحيتك لا تسمح بإخراج ملف التحويل (payroll.pay)';
  end if;
  -- **لا ملف تحويل قبل الاعتماد**: ملفٌ يُصدَّر من مسيرٍ لم يُعتمد قد يُرفع للبنك
  if v_run.status not in ('approved','paid') then
    raise exception 'لا يُخرَج ملف التحويل من مسير حالته %', v_run.status;
  end if;

  return query
  select e.name_ar,
         e.job_number::text,
         pri.bank_iban,
         pri.net_salary,
         (pri.bank_iban is not null and btrim(pri.bank_iban) <> '' and pri.net_salary > 0),
         case
           when pri.bank_iban is null or btrim(pri.bank_iban) = '' then 'لا آيبان مسجَّل'
           when pri.net_salary <= 0 then 'صافي صفر أو سالب'
         end
    from payroll_run_items pri
    join employees e on e.id = pri.employee_id
   where pri.payroll_run_id = p_run_id
   order by e.name_ar;
end $$;

-- ===========================================================================
-- 9) المناظير
-- ===========================================================================
drop view if exists v_payroll_register;
create view v_payroll_register
with (security_invoker = on) as
select
  pri.id               as payroll_item_id,
  pr.id                as payroll_run_id,
  pr.organization_id,
  pr.branch_id,
  br.name              as branch_name,
  pr.period_month      as report_date,
  pr.run_number,
  pr.status,
  pri.employee_id,
  e.name_ar            as employee_name,
  e.job_number,
  e.job_title,
  pri.basic_salary,
  pri.allowances_total,
  pri.overtime_amount,
  pri.gross_salary,
  pri.absence_deduction,
  pri.late_deduction,
  pri.loan_deduction,
  pri.other_deductions,
  pri.deductions_total,
  pri.net_salary,
  pri.worked_days,
  pri.absent_days,
  pri.late_minutes,
  pri.overtime_minutes,
  pri.bank_iban,
  (pri.bank_iban is null or btrim(pri.bank_iban) = '') as missing_iban
from payroll_run_items pri
join payroll_runs pr on pr.id = pri.payroll_run_id
join employees e on e.id = pri.employee_id
left join branches br on br.id = pr.branch_id;

comment on view v_payroll_register is
  'سجل الرواتب بحبّة الموظف: الأساسي والبدلات والإضافيّ والاستقطاعات والصافي، ومن ينقصه آيبان.';

drop view if exists v_employee_documents_expiry;
create view v_employee_documents_expiry
with (security_invoker = on) as
select
  d.id                 as document_id,
  d.organization_id,
  e.branch_id,
  br.name              as branch_name,
  d.employee_id,
  e.name_ar            as employee_name,
  e.job_number,
  d.document_type_value_id,
  lv.name_ar           as document_type,
  d.document_number,
  d.issue_date,
  d.expiry_date        as report_date,
  (d.expiry_date - current_date) as days_to_expiry,
  case
    when d.expiry_date is null                          then 'بلا تاريخ انتهاء'
    when d.expiry_date < current_date                   then 'منتهية'
    when d.expiry_date <= current_date + 30             then 'تنتهي خلال شهر'
    when d.expiry_date <= current_date + 90             then 'تنتهي خلال ثلاثة أشهر'
    else 'سارية'
  end                  as expiry_status
from employee_documents d
join employees e on e.id = d.employee_id
left join branches br on br.id = e.branch_id
left join lookup_values lv on lv.id = d.document_type_value_id;

comment on view v_employee_documents_expiry is
  'وثائق الموظفين وتواريخ انتهائها. الإقامة أو الرخصة المنتهية تُعطّل الموظف عن العمل نظاميًّا قبل أن يلاحظها أحد.';

drop view if exists v_employee_loans_status;
create view v_employee_loans_status
with (security_invoker = on) as
select
  l.id                 as loan_id,
  l.organization_id,
  e.branch_id,
  l.employee_id,
  e.name_ar            as employee_name,
  e.job_number,
  l.loan_type,
  l.amount,
  l.paid_amount,
  l.amount - l.paid_amount as remaining_amount,
  l.installment_amount,
  l.installments_count,
  case when l.installment_amount > 0
       then ceil((l.amount - l.paid_amount) / l.installment_amount) end as remaining_installments,
  l.start_month        as report_date,
  l.status,
  l.reason
from employee_loans l
join employees e on e.id = l.employee_id;

comment on view v_employee_loans_status is
  'السلف والقروض بأرصدتها المتبقّية وعدد أقساطها الباقية.';

drop view if exists v_attendance_summary;
create view v_attendance_summary
with (security_invoker = on) as
select
  a.organization_id,
  e.branch_id,
  br.name              as branch_name,
  a.employee_id,
  e.name_ar            as employee_name,
  date_trunc('month', a.work_date)::date as report_date,
  count(*)                                          as recorded_days,
  count(*) filter (where a.status = 'present')      as present_days,
  count(*) filter (where a.status = 'absent')       as absent_days,
  count(*) filter (where coalesce(a.late_minutes, 0) > 0) as late_days,
  coalesce(sum(a.late_minutes), 0)                  as total_late_minutes,
  coalesce(sum(a.early_leave_minutes), 0)           as total_early_minutes,
  coalesce(sum(a.overtime_minutes), 0)              as total_overtime_minutes,
  coalesce(sum(case when a.overtime_approved_by is not null
                    then a.overtime_minutes else 0 end), 0) as approved_overtime_minutes
from attendance_records a
join employees e on e.id = a.employee_id
left join branches br on br.id = e.branch_id
group by a.organization_id, e.branch_id, br.name, a.employee_id, e.name_ar,
         date_trunc('month', a.work_date);

comment on view v_attendance_summary is
  'ملخّص الحضور الشهريّ. الإضافيّ المعتمَد منفصلٌ عن المسجَّل — المسجَّل بلا اعتماد ليس مستحقًّا.';

grant select on v_payroll_register, v_employee_documents_expiry,
                v_employee_loans_status, v_attendance_summary to authenticated;

-- ===========================================================================
-- 10) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['employee_position_history','salary_components',
                               'employee_salary_components','employee_loans',
                               'shift_swap_requests','payroll_runs',
                               'payroll_run_items','payroll_item_details']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;
    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);
    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);
    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);
    execute format('grant select, insert, update on %I to authenticated', r.t);
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_calculate_payroll_run','app_approve_payroll_run',
                             'app_pay_payroll_run','app_cancel_payroll_run',
                             'app_payroll_bank_file','app_check_leave_conflicts',
                             'app_approve_leave_request','app_approve_shift_swap']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة الرواتب % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_indexes where indexname = 'uq_payroll_run_period') then
    raise exception 'لا حارس ضدّ مسيرين لنفس الشهر — راتبٌ مزدوج';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_approved_payroll') then
    raise exception 'المسير المعتمَد قابل للتعديل';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_log_employee_change') then
    raise exception 'تغيّر الراتب أو الفرع لا يُسجَّل';
  end if;
end $$;


-- ==========================================================================
-- نهاية الجزء 1 (الهجرات 0091–0100) — 11 هجرة
-- ==========================================================================
do $zc_done$
begin
  raise notice '=== اكتمل % بنجاح ===', 'الجزء 1 (الهجرات 0091–0100)';
end
$zc_done$;
