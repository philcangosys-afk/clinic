-- ============================================================================
-- 0027_accounting_auto_posting.sql
-- المرحلة 7.3 (الأخيرة من هذه الدفعة) — ربط المحاسبة بالفواتير/السندات
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0026 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- المحاسبة (0017) صُمِّمت عمدًا كـ"دفتر ظل" مستقل تمامًا — هذا الملف، **بعد
-- تأكيد المستخدم الصريح على خريطة الحسابات التالية**، يُنشئ قيودًا تلقائية
-- بحالة "مسودة" (draft) فقط — لا تُرحَّل تلقائيًا أبدًا — عند كل فاتورة مبيعات/
-- شراء أو سند راتب/مصروف، حتى يراجعها المحاسب ويرحِّلها يدويًا (زر "ترحيل"
-- الموجود أصلًا في شاشة المحاسبة، بكل حمايات 0017 — توازن القيد، عدم تعديل
-- قيد مُرحَّل... إلخ تنطبق عليها كأي قيد آخر بلا أي استثناء).
--
-- خريطة الحسابات المعتمدة (بالأكواد من app_seed_default_chart_of_accounts):
--   فواتير المبيعات  : مدين 1100 (نقدية) أو 1200 (ذمم مرضى) حسب المدفوع/المتبقي
--                       ← دائن 4100 (إيرادات خدمات) + دائن 2200 (ضريبة مستحقة)
--   فواتير المرتجع   : نفس الحسابات معكوسة (مدين↔دائن)
--   فواتير الشراء     : مدين 1300 (مخزون، شامل الضريبة مبسَّطًا) ← دائن 2100 (ذمم موردين)
--   سندات الرواتب     : مدين 5100 (رواتب وأجور) ← دائن 1100 (نقدية)
--   سندات المصروفات   : مدين 5300 (مصروفات متنوعة) ← دائن 1100 (نقدية)
--
-- ⚠️ قرار نطاق صريح: الترحيل التلقائي يحدث فقط عند **إنشاء** الفاتورة/السند
-- (Trigger AFTER INSERT). إلغاء فاتورة (status='void') لاحقًا أو تعديلها لا
-- يُنشئ قيد عكسي تلقائيًا — هذا يحتاج قرارًا إضافيًا من المستخدم إن رغب به
-- مستقبلاً (قيد عكسي تلقائي عند التحول لـ'void' مثلاً).
-- ⚠️ سندات القبض/الإيداع/السحب/التحويل البنكي (receipt/bank_deposit/
-- bank_withdrawal/bank_transfer) **لم تُشمَل** في هذه الخريطة المعتمدة — فقط
-- الراتب والمصروف كما وافق المستخدم صريحًا؛ توسعتها تحتاج تأكيدًا لاحقًا.
-- ⚠️ إن لم تُزرَع حسابات دليل الحسابات بعد لمؤسسة ما (لم يُستدعَ
-- app_seed_default_chart_of_accounts)، تتجاهل الدوال أدناه الترحيل بصمت —
-- المحاسبة موديول اختياري، وغيابها لا يجب أن يمنع إصدار فاتورة مبيعات.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- دالة مساعدة: جلب معرّف حساب بكوده لمؤسسة معيَّنة (null إن لم يوجد)
-- ---------------------------------------------------------------------------
create or replace function app_account_id_by_code(p_organization_id uuid, p_code text)
returns uuid
language sql
stable
as $$
  select id from chart_of_accounts where organization_id = p_organization_id and code = p_code limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 1) ترحيل فاتورة مبيعات تلقائيًا كقيد مسودة
-- ---------------------------------------------------------------------------
create or replace function app_post_sales_invoice_to_gl()
returns trigger
language plpgsql
as $$
declare
  v_cash_acc uuid;
  v_receivable_acc uuid;
  v_revenue_acc uuid;
  v_vat_acc uuid;
  v_entry_id uuid;
  v_revenue_amount numeric;
  v_is_return boolean;
begin
  if new.net_amount = 0 then
    return new;
  end if;

  v_cash_acc := app_account_id_by_code(new.organization_id, '1100');
  v_receivable_acc := app_account_id_by_code(new.organization_id, '1200');
  v_revenue_acc := app_account_id_by_code(new.organization_id, '4100');
  v_vat_acc := app_account_id_by_code(new.organization_id, '2200');

  -- لا دليل حسابات لهذه المؤسسة بعد — المحاسبة موديول اختياري، تجاهل بصمت
  if v_revenue_acc is null then
    return new;
  end if;

  v_is_return := (new.invoice_type = 'return');
  v_revenue_amount := new.net_amount - coalesce(new.vat_amount, 0);

  insert into journal_entries (organization_id, entry_date, reference_type, reference_id, status, description)
  values (new.organization_id, new.created_at::date, 'sales_invoice', new.id, 'draft',
          case when v_is_return then 'مرتجع فاتورة مبيعات #' || new.invoice_number::text
               else 'فاتورة مبيعات #' || new.invoice_number::text end)
  returning id into v_entry_id;

  if not v_is_return then
    if new.paid_amount > 0 and v_cash_acc is not null then
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
        values (v_entry_id, v_cash_acc, new.paid_amount, 0);
    end if;
    if new.remaining_amount > 0 and v_receivable_acc is not null then
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
        values (v_entry_id, v_receivable_acc, new.remaining_amount, 0);
    end if;
    if coalesce(new.vat_amount, 0) > 0 and v_vat_acc is not null then
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
        values (v_entry_id, v_vat_acc, 0, new.vat_amount);
    end if;
    insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
      values (v_entry_id, v_revenue_acc, 0, v_revenue_amount);
  else
    -- مرتجع: نفس الحسابات بعكس الجانبين
    if new.paid_amount > 0 and v_cash_acc is not null then
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
        values (v_entry_id, v_cash_acc, 0, new.paid_amount);
    end if;
    if new.remaining_amount > 0 and v_receivable_acc is not null then
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
        values (v_entry_id, v_receivable_acc, 0, new.remaining_amount);
    end if;
    if coalesce(new.vat_amount, 0) > 0 and v_vat_acc is not null then
      insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
        values (v_entry_id, v_vat_acc, new.vat_amount, 0);
    end if;
    insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
      values (v_entry_id, v_revenue_acc, v_revenue_amount, 0);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_post_sales_invoice_to_gl on sales_invoices;
create trigger trg_post_sales_invoice_to_gl
  after insert on sales_invoices
  for each row execute function app_post_sales_invoice_to_gl();

-- ---------------------------------------------------------------------------
-- 2) ترحيل فاتورة شراء تلقائيًا كقيد مسودة
-- ---------------------------------------------------------------------------
create or replace function app_post_purchase_invoice_to_gl()
returns trigger
language plpgsql
as $$
declare
  v_inventory_acc uuid;
  v_payable_acc uuid;
  v_entry_id uuid;
begin
  if new.net_amount = 0 then
    return new;
  end if;

  v_inventory_acc := app_account_id_by_code(new.organization_id, '1300');
  v_payable_acc := app_account_id_by_code(new.organization_id, '2100');

  if v_inventory_acc is null or v_payable_acc is null then
    return new;
  end if;

  insert into journal_entries (organization_id, entry_date, reference_type, reference_id, status, description)
  values (new.organization_id, new.invoice_date, 'purchase_invoice', new.id, 'draft',
          'فاتورة شراء ' || coalesce(new.invoice_number, new.id::text))
  returning id into v_entry_id;

  insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
    values (v_entry_id, v_inventory_acc, new.net_amount, 0);
  insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
    values (v_entry_id, v_payable_acc, 0, new.net_amount);

  return new;
end;
$$;

drop trigger if exists trg_post_purchase_invoice_to_gl on purchase_invoices;
create trigger trg_post_purchase_invoice_to_gl
  after insert on purchase_invoices
  for each row execute function app_post_purchase_invoice_to_gl();

-- ---------------------------------------------------------------------------
-- 3) ترحيل سند راتب/مصروف تلقائيًا كقيد مسودة — فقط هذان النوعان المعتمدان
-- ---------------------------------------------------------------------------
create or replace function app_post_voucher_to_gl()
returns trigger
language plpgsql
as $$
declare
  v_expense_acc uuid;
  v_cash_acc uuid;
  v_entry_id uuid;
begin
  if new.voucher_type not in ('salary', 'expense') or new.amount = 0 then
    return new;
  end if;

  v_cash_acc := app_account_id_by_code(new.organization_id, '1100');
  v_expense_acc := app_account_id_by_code(
    new.organization_id,
    case when new.voucher_type = 'salary' then '5100' else '5300' end
  );

  if v_expense_acc is null or v_cash_acc is null then
    return new;
  end if;

  insert into journal_entries (organization_id, entry_date, reference_type, reference_id, status, description)
  values (new.organization_id, new.voucher_date, 'financial_voucher', new.id, 'draft',
          (case when new.voucher_type = 'salary' then 'سند راتب #' else 'سند مصروف #' end) || new.voucher_number::text)
  returning id into v_entry_id;

  insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
    values (v_entry_id, v_expense_acc, new.amount, 0);
  insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
    values (v_entry_id, v_cash_acc, 0, new.amount);

  return new;
end;
$$;

drop trigger if exists trg_post_voucher_to_gl on financial_vouchers;
create trigger trg_post_voucher_to_gl
  after insert on financial_vouchers
  for each row execute function app_post_voucher_to_gl();

-- ============================================================================
-- نهاية 0027_accounting_auto_posting.sql — نهاية كامل دفعة معالجة الفجوات
-- ============================================================================
