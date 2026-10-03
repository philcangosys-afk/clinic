-- ============================================================================
-- 0219_agreement_settlements.sql — «تعديل فوترة بدون ضريبة» على الاتفاقية
-- ============================================================================
-- المشكلة (المالك، 03/10/2026): فواتير صدرت من «إصدار فاتورة» في ملفّ المريض
-- لا من داخل الاتفاقية. المريض دفع، والفاتورة الضريبية صدرت وأُبلغت، لكنّ
-- الاتفاقية لم تتأثّر — فيبقى متبقّيها كأنّه لم يدفع.
--
-- الحلّ: **تسويةٌ على الاتفاقية بلا فاتورة ولا ضريبة** — مسارٌ منفصل عن
-- الفوترة الضريبية تمامًا:
--   • تُنقص المبلغ من بنود الاتفاقية (المفوتر يزيد والمتبقّي ينقص) كما لو
--     فُوترت، وتحمل مرجعها: الفاتورة الأخرى (من النظام، أو رقمٌ يُكتب لفاتورةٍ
--     من خارجه) وملاحظة.
--   • لا تُنشئ فاتورة، ولا تمسّ أيّ فاتورة صادرة، ولا ZATCA، ولا الترقيم.
--   • الفوترة الضريبية بعدها من الاتفاقية تخصم من المتبقّي كالمعتاد.
--   • لا تُحذف: تُلغى بسببٍ (فيعود المبلغ إلى المتبقّي)، وكلّ ذلك في التدقيق.
--   • فاتورةٌ من النظام لا تُستعمل مرجعًا بأكثر من صافيها (ناقصًا ما رُبط منها
--     ببنود اتفاقيات أصلًا) — حتى لا يُخصم المبلغ نفسه مرّتين.
--
-- جدولٌ جديد لأنّه لا جدول قائم لهذا الغرض: الفواتير ضريبية ولا يُكتب فيها
-- غير الفاتورة، وبنود الاتفاقية هي الاتفاق نفسه لا ما سُدّد منه.
-- معاملة واحدة، آمنة للتكرار. للاستقبال والإدارة (billing.issue) لا للطبيب.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── ١) الجدول ───────────────────────────────────────────────────────────────
create table if not exists public.agreement_settlements (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  batch_id             uuid not null,
  agreement_id         uuid not null references treatment_agreements(id) on delete cascade,
  agreement_item_id    uuid not null references treatment_agreement_items(id) on delete cascade,
  net_amount           numeric(14,2) not null check (net_amount > 0),
  taxable_amount       numeric(14,2) not null check (taxable_amount >= 0),
  reference_invoice_id uuid references sales_invoices(id) on delete set null,
  reference_number     text,
  note                 text,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  is_cancelled         boolean not null default false,
  cancelled_by         uuid references auth.users(id),
  cancelled_at         timestamptz,
  cancel_reason        text
);

comment on table public.agreement_settlements is
  'تعديل فوترة بدون ضريبة: مبلغٌ دُفع بفاتورةٍ أخرى يُخصم من بنود الاتفاقية بلا فاتورة جديدة ولا ZATCA. يُلغى ولا يُحذف. 0219.';

create index if not exists idx_agreement_settlements_item
  on public.agreement_settlements (agreement_item_id) where not is_cancelled;
create index if not exists idx_agreement_settlements_agreement
  on public.agreement_settlements (agreement_id, created_at desc);
create index if not exists idx_agreement_settlements_invoice
  on public.agreement_settlements (reference_invoice_id) where reference_invoice_id is not null;

alter table public.agreement_settlements enable row level security;
drop policy if exists agreement_settlements_member_read on public.agreement_settlements;
create policy agreement_settlements_member_read on public.agreement_settlements
  for select using (app_is_member(organization_id));
revoke all on public.agreement_settlements from anon;
revoke insert, update, delete on public.agreement_settlements from authenticated;
grant select on public.agreement_settlements to authenticated;

-- ── ٢) أرصدة البنود: الفواتير + التسويات (الأعمدة كما في 0213 وجديدان في آخرها)
create or replace view v_agreement_item_balances
with (security_invoker = on) as
select
  ai.id                                        as agreement_item_id,
  ai.agreement_id,
  ai.quote_id,
  a.organization_id,
  ai.qty,
  coalesce(inv.qty, 0)                         as invoiced_qty,
  greatest(ai.qty - coalesce(inv.qty, 0), 0)   as remaining_qty,
  coalesce(inv.amount, 0) + coalesce(st.net, 0) as invoiced_amount,
  v.line_taxable,
  coalesce(inv.taxable, 0) + coalesce(st.taxable, 0) as invoiced_taxable,
  greatest(v.line_taxable - coalesce(inv.taxable, 0) - coalesce(st.taxable, 0), 0) as remaining_taxable,
  greatest(coalesce(nullif(ai.net_amount, 0), v.line_taxable) - coalesce(inv.amount, 0) - coalesce(st.net, 0), 0) as remaining_amount,
  -- 0219: منه بلا فاتورة
  coalesce(st.net, 0)                          as settled_amount,
  coalesce(st.taxable, 0)                      as settled_taxable
from treatment_agreement_items ai
join treatment_agreements a on a.id = ai.agreement_id
cross join lateral (
  select coalesce(nullif(ai.taxable_amount, 0),
                  round(coalesce(ai.qty, 0) * coalesce(ai.unit_price, 0), 2) - coalesce(ai.discount_amount, 0)) as line_taxable
) v
left join lateral (
  select sum(sii.qty)        as qty,
         sum(sii.net_amount) as amount,
         sum(round(coalesce(sii.qty, 0) * coalesce(sii.price, 0), 2) - coalesce(sii.discount_amount, 0)) as taxable
    from sales_invoice_items sii
    join sales_invoices si on si.id = sii.invoice_id
   where sii.agreement_item_id = ai.id
     and not coalesce(si.is_temporary, false)
     and si.status <> 'void'
     and coalesce(si.invoice_type, 'sale') = 'sale'
) inv on true
left join lateral (
  select sum(s.net_amount) as net, sum(s.taxable_amount) as taxable
    from agreement_settlements s
   where s.agreement_item_id = ai.id
     and not s.is_cancelled
) st on true;

grant select on v_agreement_item_balances to authenticated;

-- ── ٣) حارس سطر الفاتورة (0213) + التسويات في «ما فُوتر» ────────────────────
create or replace function app_guard_agreement_invoice_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_temp      boolean;
  v_status    text;
  v_type      text;
  v_line      numeric;
  v_disabled  boolean;
  v_cancelled boolean;
  v_number    bigint;
  v_desc      text;
  v_done      numeric;
  v_settled   numeric;
  v_new       numeric;
begin
  if new.agreement_item_id is null then
    return new;
  end if;

  select is_temporary, status, invoice_type into v_temp, v_status, v_type
    from sales_invoices where id = new.invoice_id;
  if coalesce(v_temp, false) or coalesce(v_type, 'sale') <> 'sale' then
    return new;
  end if;

  select coalesce(nullif(ai.taxable_amount, 0),
                  round(coalesce(ai.qty, 0) * coalesce(ai.unit_price, 0), 2) - coalesce(ai.discount_amount, 0)),
         a.is_disabled, coalesce(q.is_cancelled, false), a.agreement_number,
         coalesce(ai.description, '')
    into v_line, v_disabled, v_cancelled, v_number, v_desc
    from treatment_agreement_items ai
    join treatment_agreements a on a.id = ai.agreement_id
    left join agreement_quotes q on q.id = ai.quote_id
   where ai.id = new.agreement_item_id;
  if not found then
    return new;
  end if;

  if v_disabled then
    raise exception 'الاتفاقية #% معطّلة — فعّلها أوّلًا أو احذف بندها من الفاتورة', v_number;
  end if;
  if v_cancelled then
    raise exception 'بندٌ من عرض سعرٍ ملغى في الاتفاقية #% — احذفه من الفاتورة', v_number;
  end if;

  select coalesce(sum(round(coalesce(sii.qty, 0) * coalesce(sii.price, 0), 2) - coalesce(sii.discount_amount, 0)), 0)
    into v_done
    from sales_invoice_items sii
    join sales_invoices si on si.id = sii.invoice_id
   where sii.agreement_item_id = new.agreement_item_id
     and sii.id <> new.id
     and not coalesce(si.is_temporary, false)
     and si.status <> 'void'
     and coalesce(si.invoice_type, 'sale') = 'sale';

  -- 0219: ما سُوِّي بلا فاتورة نقص من البند كذلك
  select coalesce(sum(s.taxable_amount), 0) into v_settled
    from agreement_settlements s
   where s.agreement_item_id = new.agreement_item_id and not s.is_cancelled;
  v_done := v_done + v_settled;

  v_new := round(coalesce(new.qty, 0) * coalesce(new.price, 0), 2) - coalesce(new.discount_amount, 0);

  if v_done + v_new > v_line + 0.01 then
    raise exception 'المبلغ يتجاوز المتبقّي في الاتفاقية #%: قيمة البند % قبل الضريبة، فُوتر منه %، والمتبقّي %، والمطلوب الآن %',
      v_number, round(v_line, 2), round(v_done, 2), round(greatest(v_line - v_done, 0), 2), round(v_new, 2);
  end if;

  return new;
end $$;

-- ── ٤) التسوية ──────────────────────────────────────────────────────────────
create or replace function public.app_add_agreement_settlement(
  p_agreement_id         uuid,
  p_lines                jsonb,
  p_reference_invoice_id uuid default null,
  p_reference_number     text default null,
  p_note                 text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a          record;
  inv        record;
  e          jsonb;
  ln         record;
  v_batch    uuid := gen_random_uuid();
  v_amount   numeric;
  v_taxable  numeric;
  v_total    numeric := 0;
  v_capacity numeric;
  v_ref      text := nullif(btrim(coalesce(p_reference_number, '')), '');
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_n        int := 0;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;

  select ta.id, ta.organization_id, ta.patient_id, ta.agreement_number, ta.is_disabled,
         coalesce(ta.debt_cancelled, false) as debt_cancelled
    into a
    from treatment_agreements ta
   where ta.id = p_agreement_id
   for update;
  if not found then
    raise exception 'الاتفاقية غير موجودة';
  end if;
  if not app_is_member(a.organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(a.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بتعديل فوترة الاتفاقية (billing.issue)';
  end if;
  -- الفوترة للاستقبال: الطبيب لا يُسوّي (إلّا المالك/المدير وإن كان طبيبًا)
  if exists (select 1 from doctors d where d.organization_id = a.organization_id and d.user_id = auth.uid())
     and not app_has_role(a.organization_id, array['owner', 'organization_admin', 'branch_manager']) then
    raise exception 'تعديل الفوترة للاستقبال — لا للطبيب';
  end if;
  if a.is_disabled then
    raise exception 'الاتفاقية #% معطّلة — فعّلها أوّلًا', a.agreement_number;
  end if;
  if a.debt_cancelled then
    raise exception 'أُلغيت مديونية الاتفاقية #% — أعدها أوّلًا', a.agreement_number;
  end if;

  -- المرجع: فاتورةٌ من النظام للمريض نفسه، أو رقمٌ مكتوب لفاتورةٍ من خارجه
  if p_reference_invoice_id is not null then
    select si.id,
           coalesce(nullif(si.document_prefix, '') || '-' || si.document_number::text,
                    si.invoice_number::text, left(si.id::text, 8)) as invoice_number,
           si.patient_id, si.status, coalesce(si.is_temporary, false) as is_temporary,
           coalesce(si.invoice_type, 'sale') as invoice_type, coalesce(si.net_amount, 0) as net_amount
      into inv
      from sales_invoices si
     where si.id = p_reference_invoice_id and si.organization_id = a.organization_id;
    if not found then
      raise exception 'الفاتورة المرجع غير موجودة في هذه المنشأة';
    end if;
    if inv.patient_id is distinct from a.patient_id then
      raise exception 'الفاتورة % ليست لمريض هذه الاتفاقية', inv.invoice_number;
    end if;
    if inv.status = 'void' or inv.is_temporary or inv.invoice_type <> 'sale' then
      raise exception 'الفاتورة % ملغاة أو مؤقّتة أو ليست فاتورة بيع', inv.invoice_number;
    end if;
    v_ref := coalesce(v_ref, inv.invoice_number);
  elsif v_ref is null then
    raise exception 'اختر الفاتورة التي دُفع بها المبلغ، أو اكتب رقمها';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'وزّع المبلغ على بنود الاتفاقية';
  end if;

  for e in select value from jsonb_array_elements(p_lines) loop
    v_amount := round(coalesce(nullif(e->>'amount', '')::numeric, 0), 2);
    continue when v_amount = 0;
    if v_amount < 0 then
      raise exception 'المبلغ لا يكون سالبًا';
    end if;

    select ai.id, coalesce(ai.description, i.name_ar, 'بند') as description,
           b.line_taxable, b.remaining_amount,
           coalesce(nullif(ai.net_amount, 0), b.line_taxable) as line_net
      into ln
      from treatment_agreement_items ai
      left join items i on i.id = ai.item_id
      left join agreement_quotes q on q.id = ai.quote_id
      join v_agreement_item_balances b on b.agreement_item_id = ai.id
     where ai.id = nullif(e->>'agreement_item_id', '')::uuid
       and ai.agreement_id = a.id
       and not coalesce(q.is_cancelled, false)
     for update of ai;
    if not found then
      raise exception 'بندٌ ليس من هذه الاتفاقية أو من عرض سعرٍ ملغى';
    end if;
    if v_amount > ln.remaining_amount + 0.01 then
      raise exception '«%»: المتبقّي % والمطلوب خصمه %', ln.description, round(ln.remaining_amount, 2), v_amount;
    end if;

    -- الجزء قبل الضريبة بنسبة البند نفسه (الضريبة والإعفاء كما اتُّفق عليه)
    v_taxable := case when ln.line_net > 0
                      then least(round(v_amount * ln.line_taxable / ln.line_net, 2), ln.line_taxable)
                      else v_amount end;

    insert into agreement_settlements (organization_id, batch_id, agreement_id, agreement_item_id,
                                       net_amount, taxable_amount, reference_invoice_id, reference_number,
                                       note, created_by)
    values (a.organization_id, v_batch, a.id, ln.id, v_amount, v_taxable, p_reference_invoice_id, v_ref,
            v_note, auth.uid());
    v_total := v_total + v_amount;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'اكتب المبلغ على بندٍ واحد على الأقل';
  end if;

  -- الفاتورة المرجع لا تُستعمل بأكثر من صافيها: ناقصًا ما رُبط منها ببنود
  -- اتفاقيات، وما سُوِّي عليها من قبل (هذه التسوية داخلة)
  if p_reference_invoice_id is not null then
    select inv.net_amount
           - coalesce((select sum(sii.net_amount) from sales_invoice_items sii
                        where sii.invoice_id = inv.id and sii.agreement_item_id is not null), 0)
           - coalesce((select sum(s.net_amount) from agreement_settlements s
                        where s.reference_invoice_id = inv.id and not s.is_cancelled), 0)
      into v_capacity;
    if v_capacity < -0.01 then
      raise exception 'الفاتورة % صافيها % — ولا يبقى منها ما يكفي لخصم % (رُبط منها أو سُوِّي عليها من قبل)',
        inv.invoice_number, round(inv.net_amount, 2), v_total;
    end if;
  end if;

  perform app_agreement_refresh(a.id);

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (a.organization_id, auth.uid(), 'billing', 'update', a.id,
          'تعديل فوترة بدون ضريبة — اتفاقية #' || a.agreement_number,
          format('خُصم %s من الاتفاقية بمرجع فاتورة %s%s', v_total, v_ref,
                 case when v_note is not null then ' — ' || v_note else '' end));

  return v_batch;
end $$;

revoke all on function public.app_add_agreement_settlement(uuid, jsonb, uuid, text, text) from public, anon;
grant execute on function public.app_add_agreement_settlement(uuid, jsonb, uuid, text, text) to authenticated;

comment on function public.app_add_agreement_settlement(uuid, jsonb, uuid, text, text) is
  'تعديل فوترة بدون ضريبة: يخصم من بنود الاتفاقية مبلغًا دُفع بفاتورةٍ أخرى (مرجعها رقمها) بلا فاتورة جديدة. 0219.';

create or replace function public.app_cancel_agreement_settlement(p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_agr     uuid;
  v_number  bigint;
  v_total   numeric;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  select s.organization_id, s.agreement_id, sum(s.net_amount)
    into v_org, v_agr, v_total
    from agreement_settlements s
   where s.batch_id = p_batch_id and not s.is_cancelled
   group by s.organization_id, s.agreement_id;
  if v_org is null then
    raise exception 'التعديل غير موجود أو أُلغي من قبل';
  end if;
  if not app_has_permission(v_org, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بتعديل فوترة الاتفاقية (billing.issue)';
  end if;
  if v_reason is null then
    raise exception 'اكتب سبب الإلغاء';
  end if;

  perform 1 from treatment_agreements where id = v_agr for update;

  update agreement_settlements
     set is_cancelled = true, cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where batch_id = p_batch_id and not is_cancelled;

  perform app_agreement_refresh(v_agr);

  select agreement_number into v_number from treatment_agreements where id = v_agr;
  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_org, auth.uid(), 'billing', 'update', v_agr,
          'إلغاء تعديل فوترة بدون ضريبة — اتفاقية #' || v_number,
          format('أُعيد %s إلى المتبقّي — %s', v_total, v_reason));
end $$;

revoke all on function public.app_cancel_agreement_settlement(uuid, text) from public, anon;
grant execute on function public.app_cancel_agreement_settlement(uuid, text) to authenticated;

-- ── ٥) قائمة التسويات للشاشة ────────────────────────────────────────────────
create or replace view v_agreement_settlements
with (security_invoker = on) as
select
  s.batch_id,
  s.organization_id,
  s.agreement_id,
  min(s.created_at)                          as created_at,
  sum(s.net_amount)                          as net_amount,
  string_agg(coalesce(ai.description, i.name_ar, 'بند') || ' (' || s.net_amount || ')', '، ' order by ai.sort_order) as lines,
  max(s.reference_number)                    as reference_number,
  (array_agg(s.reference_invoice_id))[1]     as reference_invoice_id,
  max(s.note)                                as note,
  bool_or(s.is_cancelled)                    as is_cancelled,
  max(s.cancel_reason)                       as cancel_reason,
  max(s.cancelled_at)                        as cancelled_at,
  max(cb.display_name)                       as created_by_name,
  max(xb.display_name)                       as cancelled_by_name
from agreement_settlements s
join treatment_agreement_items ai on ai.id = s.agreement_item_id
left join items i on i.id = ai.item_id
left join v_organization_members_directory cb on cb.user_id = s.created_by and cb.organization_id = s.organization_id
left join v_organization_members_directory xb on xb.user_id = s.cancelled_by and xb.organization_id = s.organization_id
group by s.batch_id, s.organization_id, s.agreement_id;

revoke all on v_agreement_settlements from anon;
grant select on v_agreement_settlements to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── النتيجة ─────────────────────────────────────────────────────────────────
select 'جدول التسويات' as "البند", (select count(*) from agreement_settlements)::text as "القيمة"
union all
select 'الحارس يحسب التسويات',
       case when position('agreement_settlements' in pg_get_functiondef('app_guard_agreement_invoice_line'::regproc)) > 0
            then 'نعم' else 'لا' end
union all
select 'أرصدة البنود تحسب التسويات',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'v_agreement_item_balances' and column_name = 'settled_amount')
            then 'نعم' else 'لا' end;
