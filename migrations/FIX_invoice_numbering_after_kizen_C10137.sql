-- ============================================================================
-- FIX — ترقيم فواتير ZainCare بعد آخر فاتورة أصدرها Kizen (C-10137)
-- ============================================================================
--
-- **عاجل — يُنفَّذ الآن، قبل الفاتورة التالية.**
--
-- ما حدث (تصدير Kizen الساعة 17:30، 01/10/2026): بعد مراجعة 14:10 أصدر Kizen
-- أربع فواتير: C-10134 (14:31) وC-10135 وC-10136 وC-10137 (حتى 15:38). وكان
-- ترقيم ZainCare قد ضُبط على آخر رقمٍ في تصدير 14:10 (C-10133)، فأصدر ZainCare
-- C-10134 الساعة 16:34 — الرقم نفسه لفاتورةٍ أخرى من Kizen. والتالي في ZainCare
-- كان سيكون C-10135، وهو مستعمل في Kizen أيضًا.
--
-- ما يفعله:
--   * يضبط تسلسل الفواتير على 10137 إن كان أقلّ — فالتالي C-10138.
--   * يسرد فواتير ZainCare التي صدرت بأرقامٍ استعملها Kizen (C-10134…C-10137)
--     ولا يغيّرها: صدرت وأُبلغت ZATCA، والفاتورة الصادرة لا يُعاد ترقيمها.
--   * الإشعارات الدائنة لا تتغيّر: آخر مرتجع في Kizen ما زال CR-27.
--
-- آمنٌ لإعادة التنفيذ: لا يُنقص التسلسل أبدًا.
-- ============================================================================

begin;

do $$
declare
  c_kizen_last constant bigint := 10137;   -- آخر فاتورة في Kizen: C-10137 (تصدير 17:30)
  v_org  uuid;
  v_cur  bigint;
  v_dups text;
begin
  select id into v_org from public.organizations
   where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
   order by created_at limit 1;
  if v_org is null then
    raise exception 'لم تُعثر على منشأة «مجمع أسناني المتميز الطبي»';
  end if;

  select current_value into v_cur
    from public.document_number_sequences
   where organization_id = v_org and branch_id is null and document_kind = 'invoice';

  if v_cur is null then
    insert into public.document_number_sequences (organization_id, branch_id, document_kind, current_value)
    values (v_org, null, 'invoice', c_kizen_last);
  elsif v_cur < c_kizen_last then
    update public.document_number_sequences
       set current_value = c_kizen_last, updated_at = now()
     where organization_id = v_org and branch_id is null and document_kind = 'invoice';
  end if;

  select string_agg(coalesce(document_prefix, '') || '-' || document_number
                    || ' (' || to_char(issued_at at time zone 'Asia/Riyadh', 'HH24:MI') || ')', '، '
                    order by document_number)
    into v_dups
    from public.sales_invoices
   where organization_id = v_org
     and issued_at is not null
     and coalesce(document_prefix, '') = 'C'
     and coalesce(document_type, 'simplified') not in ('credit_note', 'debit_note')
     and document_number between 10134 and c_kizen_last;

  insert into public.audit_log (organization_id, action_type, module, entity_title, details)
  values (v_org, 'update', 'billing', 'ترقيم الفواتير',
          format('التسلسل بعد آخر فاتورة Kizen (C-%s): كان %s — التالي C-%s. صدرت في ZainCare بأرقام Kizen: %s',
                 c_kizen_last, coalesce(v_cur::text, '—'), greatest(coalesce(v_cur, 0), c_kizen_last) + 1,
                 coalesce(v_dups, 'لا شيء')));

  raise notice 'التسلسل كان % — الفاتورة التالية C-%', v_cur, greatest(coalesce(v_cur, 0), c_kizen_last) + 1;
  if v_dups is not null then
    raise notice 'فواتير ZainCare بأرقامٍ أصدرها Kizen أيضًا (لم تُغيَّر): %', v_dups;
  end if;
end $$;

commit;

-- ── ما سيصدر تاليًا، وفواتير ZainCare التي تشارك Kizen أرقامها ─────────────
select 'الفاتورة التالية' as "البند",
       coalesce(v.invoice_number_prefix, 'C') || '-' || (s.current_value + 1) as "القيمة"
  from public.document_number_sequences s
  join public.organizations o on o.id = s.organization_id
  left join public.organization_vat_settings v on v.organization_id = s.organization_id
 where o.name = 'مجمع أسناني المتميز الطبي' and s.branch_id is null and s.document_kind = 'invoice'
union all
select 'رقمٌ أصدره Kizen أيضًا',
       coalesce(i.document_prefix, '') || '-' || i.document_number || ' — ' ||
       to_char(i.issued_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' — ' || i.net_amount || ' ر.س'
  from public.sales_invoices i
  join public.organizations o on o.id = i.organization_id
 where o.name = 'مجمع أسناني المتميز الطبي'
   and i.issued_at is not null and i.document_prefix = 'C'
   and coalesce(i.document_type, 'simplified') not in ('credit_note', 'debit_note')
   and i.document_number between 10134 and 10137;
