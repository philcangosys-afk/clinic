-- ============================================================================
-- 0235_fix_negative_invoice_lines.sql — لا سعر سالب في الفواتير
-- ============================================================================
-- شكوى المالك (10/10/2026): فاتورتان (175 و181) عُدِّلتا بالخطأ فظهرتا بالسالب
-- ولم تُبلَّغا ZATCA.
--
-- ما حدث: أُدخل سعر البند سالبًا (−99 و−20). الخصم يُسقَف بمجموع السطر، فلمّا
-- صار المجموع سالبًا صار الخصم مثله (−99 و−20)، وخرج الصافي صفرًا والفاتورة
-- «مدفوعة» بلا دفع. ثمّ رفضها الربط مع ZATCA **قبل الإرسال** («توجد كمية أو
-- قيمة خصم غير صالحة») — فلم يصل للهيئة شيء ولا رقم عدّاد (ICV) — وتوقّف
-- الإبلاغ المجدول عنها بعد 60 محاولة.
--
-- الإصلاح:
--   ١) تصحيح الإشارة في الفواتير غير المُبلَّغة فقط، وبشرطٍ صارم: لا يتغيّر صافي
--      أيّ سطر ولا صافي الفاتورة. سعر −99 وخصم −99 يصيران 99 و99 — والصافي
--      صفرٌ كما كان، فلا يمسّ ذلك سندًا ولا صندوقًا ولا يوميةً ولا قيدًا.
--      ما لا يحقّق الشرط، أو ما وصل الهيئة، لا يُمسّ ويُذكر في التنبيهات.
--      حارسا «الفاتورة الصادرة لا تُعدَّل» وحارس الخصم يُعطَّلان داخل المعاملة
--      نفسها وتحت القفل ثمّ يُعادان — فلا يراهما معطَّلين أحد، ولا تُعدَّل
--      دوالّهما الحيّة.
--   ٢) يُصفَّر عدّاد محاولات الإبلاغ لهاتين الفاتورتين، فيبلّغهما الإبلاغ
--      المجدول خلال دقائق.
--   ٣) حارسان دائمان: لا سعر سالب، ولا كمية صفرية أو سالبة، ولا خصم سالب أو
--      أكبر من مجموع السطر، ولا نسبة خصم خارج 0–100 — على البنود؛ ولا مجاميع
--      سالبة على رأس الفاتورة.
--
-- لا يُحذف شيء. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

lock table public.sales_invoices in share row exclusive mode;
lock table public.sales_invoice_items in share row exclusive mode;

-- ── ١) تصحيح الإشارة ────────────────────────────────────────────────────────
alter table public.sales_invoices
  disable trigger trg_guard_issued_invoice;
alter table public.sales_invoice_items
  disable trigger trg_guard_issued_invoice_lines,
  disable trigger trg_guard_invoice_item_price;

do $$
declare
  v_reason  constant text := 'تصحيح إشارة سالبة أُدخلت بالخطأ (0235)';
  r         record;
  v_bad     int;
  v_sub     numeric;
  v_disc    numeric;
  v_vat     numeric;
  v_lines   numeric;
  v_fixed   int := 0;
begin
  for r in
    select i.id, i.invoice_number, i.organization_id, i.branch_id, i.zatca_status,
           i.subtotal_amount, i.discount_amount, i.vat_amount, i.net_amount
      from public.sales_invoices i
     where exists (select 1 from public.sales_invoice_items it
                    where it.invoice_id = i.id
                      and (it.price < 0 or it.qty < 0 or it.discount_amount < 0))
     order by i.invoice_number
  loop
    -- ما وصل الهيئة (أو قد يكون وصلها) لا يُصحَّح هنا — بإشعار دائن فقط.
    if coalesce(r.zatca_status, '') in ('reported', 'cleared', 'ambiguous', 'submitted')
       or exists (select 1 from public.zatca_invoice_submission_logs l
                   where l.invoice_id = r.id
                     and (l.icv is not null
                          or l.status in ('reported', 'cleared', 'accepted', 'ambiguous'))) then
      raise notice 'الفاتورة % وصلت ZATCA أو حالتها غير محسومة — لم تُمسّ؛ صحِّحها بإشعار دائن', r.invoice_number;
      continue;
    end if;

    -- قلب الإشارة لا يغيّر صافي أيّ سطر — وإلّا فالتصحيح مسألة مال لا إشارة.
    select count(*) filter (
             where round(abs(price) * abs(qty) - abs(coalesce(discount_amount, 0)), 2) < 0
                or abs(round(abs(price) * abs(qty) - abs(coalesce(discount_amount, 0)), 2)
                       + coalesce(vat_amount, 0) - coalesce(net_amount, 0)) > 0.01
                or qty = 0),
           coalesce(sum(round(abs(price) * abs(qty), 2)), 0),
           coalesce(sum(abs(coalesce(discount_amount, 0))), 0),
           coalesce(sum(coalesce(vat_amount, 0)), 0),
           coalesce(sum(coalesce(net_amount, 0)), 0)
      into v_bad, v_sub, v_disc, v_vat, v_lines
      from public.sales_invoice_items
     where invoice_id = r.id;

    if v_bad > 0
       or abs(v_lines - coalesce(r.net_amount, 0)) > 0.01
       or abs(v_sub - v_disc + v_vat - coalesce(r.net_amount, 0)) > 0.01
       or abs(v_vat - coalesce(r.vat_amount, 0)) > 0.01 then
      raise notice 'الفاتورة %: قلب الإشارة يغيّر صافيها — لم تُمسّ؛ ألغِها وأصدر غيرها', r.invoice_number;
      continue;
    end if;

    update public.sales_invoice_items
       set price           = abs(price),
           qty             = abs(qty),
           discount_amount = abs(coalesce(discount_amount, 0)),
           discount_reason = case
                               when abs(coalesce(discount_amount, 0)) > 0
                               then coalesce(nullif(btrim(discount_reason), ''), v_reason)
                               else discount_reason
                             end
     where invoice_id = r.id;

    update public.sales_invoices
       set subtotal_amount = v_sub,
           discount_amount = v_disc
     where id = r.id;

    -- رُفضت قبل الإرسال (بلا ICV): يُصفَّر العدّاد فيعيدها الإبلاغ المجدول.
    update public.zatca_invoice_submission_logs
       set attempt_count = 0,
           retry_after   = null
     where invoice_id = r.id
       and icv is null
       and status = 'rejected';

    insert into public.audit_log (organization_id, branch_id, user_id, module, action_type,
                                  entity_id, entity_title, details, reason)
    values (r.organization_id, r.branch_id, null, 'billing', 'update', r.id,
            'تصحيح إشارة بنود الفاتورة ' || r.invoice_number::text,
            format('الإجمالي %s ← %s · الخصم %s ← %s · الصافي %s بلا تغيير',
                   r.subtotal_amount, v_sub, r.discount_amount, v_disc, r.net_amount),
            v_reason);

    v_fixed := v_fixed + 1;
    raise notice 'صُحِّحت الفاتورة %: الإجمالي % والخصم % والصافي % كما هو',
      r.invoice_number, v_sub, v_disc, r.net_amount;
  end loop;

  raise notice 'فواتير صُحِّحت: %', v_fixed;
end $$;

alter table public.sales_invoices
  enable trigger trg_guard_issued_invoice;
alter table public.sales_invoice_items
  enable trigger trg_guard_issued_invoice_lines,
  enable trigger trg_guard_invoice_item_price;

-- ── ٢) الحارس الدائم على البنود ─────────────────────────────────────────────
-- يُسمّى بـ zz ليعمل **آخر** محفّزات BEFORE (تُنفَّذ أبجديًّا) فيرى القيم
-- النهائية بعد ما تملؤه المحفّزات الأخرى.
create or replace function public.app_guard_invoice_line_values()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name text := coalesce(nullif(btrim(new.item_name_snapshot), ''), nullif(btrim(new.description), ''), 'البند');
begin
  if new.price is null or new.price < 0 then
    raise exception 'سعر «%» لا يكون سالبًا (%) — للتخفيض استعمل الخصم، وللاسترداد أصدر إشعارًا دائنًا',
      v_name, new.price using errcode = 'check_violation';
  end if;
  if new.qty is null or new.qty <= 0 then
    raise exception 'كمية «%» يجب أن تكون أكبر من صفر (%)', v_name, new.qty
      using errcode = 'check_violation';
  end if;
  if coalesce(new.discount_amount, 0) < 0 then
    raise exception 'خصم «%» لا يكون سالبًا (%)', v_name, new.discount_amount
      using errcode = 'check_violation';
  end if;
  if coalesce(new.discount_percent, 0) < 0 or coalesce(new.discount_percent, 0) > 100 then
    raise exception 'نسبة خصم «%» بين 0 و100 (%)', v_name, new.discount_percent
      using errcode = 'check_violation';
  end if;
  if coalesce(new.discount_amount, 0) > round(new.price * new.qty, 2) + 0.005 then
    raise exception 'خصم «%» (%) أكبر من مجموع السطر (%)',
      v_name, new.discount_amount, round(new.price * new.qty, 2) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_zz_guard_invoice_line_values on public.sales_invoice_items;
create trigger trg_zz_guard_invoice_line_values
  before insert or update of price, qty, discount_amount, discount_percent
  on public.sales_invoice_items
  for each row execute function public.app_guard_invoice_line_values();

comment on function public.app_guard_invoice_line_values() is
  'لا سعر سالب، ولا كمية ≤ 0، ولا خصم سالب أو فوق مجموع السطر، ولا نسبة خصم خارج 0–100. 0235.';

-- ── ٣) الحارس الدائم على رأس الفاتورة ──────────────────────────────────────
create or replace function public.app_guard_invoice_header_values()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.subtotal_amount, 0) < 0
     or coalesce(new.discount_amount, 0) < 0
     or coalesce(new.vat_amount, 0) < 0
     or coalesce(new.net_amount, 0) < 0 then
    raise exception 'مجاميع الفاتورة لا تكون سالبة (الإجمالي % · الخصم % · الضريبة % · الصافي %) — للاسترداد أصدر إشعارًا دائنًا',
      new.subtotal_amount, new.discount_amount, new.vat_amount, new.net_amount
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_zz_guard_invoice_header_values on public.sales_invoices;
create trigger trg_zz_guard_invoice_header_values
  before insert or update of subtotal_amount, discount_amount, vat_amount, net_amount
  on public.sales_invoices
  for each row execute function public.app_guard_invoice_header_values();

comment on function public.app_guard_invoice_header_values() is
  'مجاميع رأس الفاتورة لا تكون سالبة. 0235.';

-- ── تحقّق: لا يبقى سالبٌ في فاتورةٍ لم تصل الهيئة ──────────────────────────
do $$
declare
  v_left int;
begin
  select count(distinct it.invoice_id) into v_left
    from public.sales_invoice_items it
    join public.sales_invoices i on i.id = it.invoice_id
   where (it.price < 0 or it.qty <= 0 or it.discount_amount < 0)
     and coalesce(i.zatca_status, '') not in ('reported', 'cleared', 'ambiguous', 'submitted');
  if v_left > 0 then
    raise notice 'بقيت % فاتورة ببنودٍ سالبة لم تُصحَّح تلقائيًّا — راجع التنبيهات أعلاه', v_left;
  end if;
end $$;

commit;
