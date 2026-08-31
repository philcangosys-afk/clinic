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
