-- ============================================================================
-- 0206 — الإشعار الدائن يُنقص متبقّي فاتورته
-- ============================================================================
--
-- قرار المالك (01/10/2026): إشعارٌ دائن يصدر على فاتورةٍ لم تُسدَّد كلّها
-- **يُنقص متبقّيها**؛ والباقي منه — إن كانت مسدَّدة — يُردّ نقدًا بـ«استرداد».
--
-- قبلها: الإشعار يصدر، والفاتورة الأصلية تبقى بمتبقّيها كاملًا ذمّةً على
-- المريض، فيُطالَب بما أُرجع.
--
-- التصميم:
--   * الفاتورة الصادرة لا تُعدَّل مبالغها (0091)، و`remaining_amount` محسوب
--     (الصافي − المدفوع). فالتسوية تدخل «المدفوع» كما يدخله السند:
--     المدفوع = المقبوض − المستردّ + **المُسوّى بإشعار**.
--   * المُسوّى بإشعار = الأقلّ من (مجموع صافي الإشعارات الدائنة الصادرة غير
--     الملغاة) و(الصافي − صافي المقبوض نقدًا). يُحسب في كلّ إعادة حساب لا مرّةً
--     عند الإصدار: فإن رُدّ نقدٌ بعد الإشعار غطّى الإشعار مكانه، فلا يعود
--     متبقٍّ على ما أُرجع كلّه، ولا يصير المتبقّي سالبًا.
--   * `sales_invoices.credited_amount` (على الأصل): ذلك المُسوّى — يُعرض بجانب
--     «المدفوع» فلا يُقرأ تحصيلًا نقديًّا.
--   * إلغاء الإشعار يُعيد متبقّي الأصل.
--   * الاسترداد النقديّ يُقاس بالمقبوض نقدًا لا بالمدفوع: ما سُوّي بإشعار لم
--     يُقبض، فلا يُردّ.
--
-- آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

alter table sales_invoices
  add column if not exists credited_amount numeric(14,2) not null default 0;

comment on column sales_invoices.credited_amount is
  'للفاتورة: مجموع ما سوّته إشعاراتها الدائنة الصادرة غير الملغاة — داخلٌ في paid_amount وليس نقدًا. 0206.';

-- ---------------------------------------------------------------------------
-- ١) المدفوع = المقبوض − المستردّ + المُسوّى بإشعار
-- ---------------------------------------------------------------------------
/** منسوخة من 0091، ويُضاف إليها المُسوّى بالإشعارات الدائنة. */
create or replace function app_recalc_invoice_paid_amount(target_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paid     numeric;
  v_refunded numeric;
  v_credited numeric;
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

  -- 0206: صافي الإشعارات الدائنة الصادرة غير الملغاة
  select coalesce(sum(n.net_amount), 0) into v_credited
    from sales_invoices n
   where n.corrects_invoice_id = target_invoice
     and n.document_type = 'credit_note'
     and n.issued_at is not null
     and n.status not in ('void', 'draft');

  select net_amount, status into v_net, v_status
    from sales_invoices where id = target_invoice;

  -- **الملغاة والمسوّدة لا تُحسَب حالتهما من المال.**
  if v_status in ('void','draft') then
    update sales_invoices
       set paid_amount = v_paid, refunded_amount = v_refunded, credited_amount = v_credited
     where id = target_invoice;
    return;
  end if;

  -- الإشعار يسوّي ما لم يغطّه النقد وحده — لا يتجاوز الصافي
  v_credited := least(v_credited, greatest(coalesce(v_net, 0) - (v_paid - v_refunded), 0));

  v_new := case
    when v_refunded >= v_paid and v_refunded > 0 then 'refunded'
    when v_refunded > 0                          then 'partially_refunded'
    when v_paid + v_credited <= 0                then 'unpaid'
    when v_paid - v_refunded + v_credited >= coalesce(v_net, 0) - 0.001 then 'paid'
    else 'partial'
  end;

  update sales_invoices
     set paid_amount      = v_paid - v_refunded + v_credited,
         refunded_amount  = v_refunded,
         credited_amount  = v_credited,
         status           = v_new
   where id = target_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- ٢) إصدار الإشعار الدائن أو إلغاؤه يُعيد حساب فاتورته
-- ---------------------------------------------------------------------------
create or replace function app_credit_note_resettle_original()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.document_type = 'credit_note'
     and new.corrects_invoice_id is not null
     and ((old.issued_at is null and new.issued_at is not null)
          or (new.status = 'void' and old.status is distinct from 'void')) then
    perform app_recalc_invoice_paid_amount(new.corrects_invoice_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_credit_note_resettle_original on sales_invoices;
create trigger trg_credit_note_resettle_original
  after update on sales_invoices
  for each row execute function app_credit_note_resettle_original();

-- ---------------------------------------------------------------------------
-- ٣) الاسترداد النقديّ بالمقبوض نقدًا — لا بما سُوّي بإشعار
-- ---------------------------------------------------------------------------
-- ترقيعٌ نصّيّ لسطرٍ واحد في `app_refund_invoice_payment` (0091): القابل
-- للاسترداد كان «المدفوع − المستردّ»، والمدفوع صار يشمل التسوية بالإشعار
-- (وكان أصلًا صافيًا من المستردّ، فيُطرح المستردّ مرّتين). الآن: المقبوض
-- بسندات القبض − المستردّ.
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refund_invoice_payment';
  if v_def is null then
    raise exception 'app_refund_invoice_payment غير موجودة — نفِّذ 0091 أوّلًا';
  end if;
  v_def := replace(v_def, chr(13), '');
  if v_def like '%0206%' then
    raise notice 'app_refund_invoice_payment: مُرقَّعة سلفًا';
    return;
  end if;
  v_new := replace(v_def,
    'v_available := coalesce(v_inv.paid_amount, 0) - v_refunded;',
    '-- 0206: المقبوض نقدًا بسندات القبض − المستردّ (لا «المدفوع» الذي يشمل التسوية بإشعار)
  v_available := coalesce((select sum(a.amount)
                             from voucher_invoice_allocations a
                             join financial_vouchers v on v.id = a.voucher_id
                            where a.sales_invoice_id = p_invoice_id
                              and v.voucher_type = ''receipt'' and not v.is_void), 0) - v_refunded;');
  if v_new = v_def then
    raise exception 'app_refund_invoice_payment: تعذّر العثور على حساب القابل للاسترداد';
  end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- ٤) الفواتير التي صدرت عليها إشعارات قبل 0206
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select distinct n.corrects_invoice_id as invoice_id
      from sales_invoices n
     where n.document_type = 'credit_note'
       and n.corrects_invoice_id is not null
       and n.issued_at is not null
       and n.status not in ('void', 'draft')
  loop
    perform app_recalc_invoice_paid_amount(r.invoice_id);
    v_n := v_n + 1;
  end loop;
  raise notice '0206: فواتير أُعيد حساب مدفوعها بإشعاراتها الدائنة: %', v_n;
end $$;

commit;

notify pgrst, 'reload schema';
