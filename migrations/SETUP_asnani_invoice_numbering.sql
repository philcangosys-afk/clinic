-- ============================================================================
-- SETUP — ترقيم فواتير ZainCare يكمل من Kizen: مجمع أسناني المتميز الطبي
-- ============================================================================
--
-- ليست ترقيةً في التسلسل: بياناتُ منشأةٍ بعينها. قرار المالك (30/09/2026):
-- الفاتورة التالية في ZainCare = آخر رقم زاتكا في Kizen + 1، بالبادئة نفسها.
--
--   الفواتير:        C-<آخر رقم + 1>
--   الإشعار الدائن:  CR-<آخر رقم + 1>   (مرتجعات Kizen)
--   الإشعار المدين:  DN-1 …             (لا مقابل له في Kizen — بادئة مستقلّة
--                                          حتى لا يُطبع «C-1» فيشبه فاتورةً قديمة)
--
-- **قبل التنفيذ:** ضع في السطرين المعلَّمين أدناه آخر رقمين من تصدير Kizen
-- النهائيّ (بعد إقفاله) — أكبر قيمة في عمود «ر. زاتكا» تبدأ بـ C- وأكبر قيمة
-- تبدأ بـ CR-. القيمتان الحاليتان هما حتى 30/09 الساعة 09:52.
--
-- ما لا يمسّه:
--   * عدّاد ZATCA (ICV) وسلسلة التجزئة (PIH) لجهاز الإنتاج — شيءٌ آخر غير
--     الرقم الظاهر، ولا يُقرأ ولا يُكتب هنا.
--   * أيّ فاتورة صدرت: البادئة والرقم يُختمان عند الإصدار ويبقيان.
--
-- الحارسان — يتوقّف ولا يغيّر شيئًا إن:
--   * وُجد في ZainCare مستندٌ صادر من النوع نفسه رقمُه أكبر من الرقم الأخير
--     المُدخَل (الرقم المستهدف أو ما بعده مستعمَل)؛
--   * أو وُجد مستندٌ صدر في ZainCare بالبادئة C/CR برقمٍ داخل مدى Kizen —
--     أي مكرَّر مع فاتورةٍ من Kizen.
-- فإعادة التشغيل آمنة، وتشغيله برقمٍ أصغر بعد أن صدرت فواتير يُرفض.
--
-- **التوقيت:** يُشغَّل بعد إقفال Kizen نهائيًّا وقبل أول فاتورة في ZainCare.
-- تشغيله صباحًا برقمٍ مؤقّت ثم الإصدار من النظامين معًا يُنتج أرقامًا مكرّرة.
--
-- يحتاج الترقية 0196 (بادئة مستقلّة للإشعارات).
-- ============================================================================

begin;

do $$
declare
  -- ══════════ عدّل هذين الرقمين فقط ══════════
  c_last_invoice bigint := 10095;   -- آخر فاتورة في Kizen:  C-10095
  c_last_credit  bigint := 27;      -- آخر مرتجع في Kizen:  CR-27
  -- ════════════════════════════════════════════
  c_inv_prefix constant text := 'C';
  c_cn_prefix  constant text := 'CR';
  c_dn_prefix  constant text := 'DN';

  v_org    uuid;
  v_scope  text;
  v_bad    text;
  v_cur    bigint;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'organization_vat_settings'
                    and column_name = 'credit_note_prefix') then
    raise exception 'نفّذ الترقية 0196_document_prefix_per_kind.sql أوّلًا';
  end if;
  if c_last_invoice is null or c_last_invoice < 1 or c_last_credit is null or c_last_credit < 0 then
    raise exception 'الرقمان في أعلى السكربت غير صالحين';
  end if;

  select id into v_org from public.organizations
   where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
   order by created_at limit 1;
  if v_org is null then
    raise exception 'لم تُعثر على منشأة «مجمع أسناني المتميز الطبي»';
  end if;

  select numbering_scope into v_scope
    from public.organization_vat_settings where organization_id = v_org;
  if v_scope is null then
    raise exception 'لا إعدادات ضريبة للمنشأة — نفّذ SETUP_asnani_identity.sql أوّلًا';
  end if;
  if v_scope <> 'organization' then
    -- الترقيم لكلّ فرع يعني تسلسلًا لكلّ فرع، وKizen تسلسلٌ واحد للمنشأة
    raise exception 'نطاق الترقيم «%» لا «organization» — القرار يحتاج المالك قبل المتابعة', v_scope;
  end if;

  -- ── الحارس: لا مستندٌ صادر من النوع نفسه برقمٍ أكبر من الأخير ─────────
  select string_agg(coalesce(document_prefix, '') || '-' || document_number, '، '
                    order by document_number)
    into v_bad
    from public.sales_invoices
   where organization_id = v_org
     and issued_at is not null
     and document_number is not null
     and coalesce(document_type, 'simplified') not in ('credit_note', 'debit_note')
     and document_number > c_last_invoice;
  if v_bad is not null then
    raise exception 'فواتير صادرة في ZainCare برقمٍ أكبر من % — لا يُعاد الترقيم فوقها: %',
      c_last_invoice, left(v_bad, 500);
  end if;

  select string_agg(coalesce(document_prefix, '') || '-' || document_number, '، '
                    order by document_number)
    into v_bad
    from public.sales_invoices
   where organization_id = v_org
     and issued_at is not null
     and document_number is not null
     and document_type = 'credit_note'
     and document_number > c_last_credit;
  if v_bad is not null then
    raise exception 'إشعارات دائنة صادرة في ZainCare برقمٍ أكبر من % — لا يُعاد الترقيم فوقها: %',
      c_last_credit, left(v_bad, 500);
  end if;

  -- ── والعكس: مستندٌ صدر في ZainCare بالبادئة C/CR ورقمُه داخل مدى Kizen ──
  -- يعني أنّ ZainCare أصدر أرقامًا أصدرها Kizen أيضًا (شُغِّل السكربت صباحًا
  -- بآخر رقمٍ مؤقّت ثم استمرّ Kizen يُصدر). رقمان متطابقان لفاتورتين مختلفتين
  -- لا يُصلحهما تحريك التسلسل — يحتاجان قرار المالك والمحاسب.
  select string_agg(coalesce(document_prefix, '') || '-' || document_number, '، '
                    order by document_number)
    into v_bad
    from public.sales_invoices
   where organization_id = v_org
     and issued_at is not null
     and document_number is not null
     and ((document_prefix = c_inv_prefix
           and coalesce(document_type, 'simplified') not in ('credit_note', 'debit_note')
           and document_number <= c_last_invoice)
       or (document_prefix = c_cn_prefix
           and document_type = 'credit_note'
           and document_number <= c_last_credit));
  if v_bad is not null then
    raise exception 'مستندات صدرت في ZainCare بأرقامٍ داخل مدى Kizen (مكرّرة معه): % — أوقف الإصدار وراجع المالك',
      left(v_bad, 500);
  end if;

  -- ── البادئات ──────────────────────────────────────────────────────────────
  update public.organization_vat_settings
     set invoice_number_prefix = c_inv_prefix,
         credit_note_prefix    = c_cn_prefix,
         debit_note_prefix     = c_dn_prefix
   where organization_id = v_org;

  -- ── التسلسلان: القيمة الحالية = آخر رقم، فالتالي = آخر رقم + 1 ─────────
  update public.document_number_sequences
     set current_value = c_last_invoice, updated_at = now()
   where organization_id = v_org and branch_id is null and document_kind = 'invoice';
  if not found then
    insert into public.document_number_sequences (organization_id, branch_id, document_kind, current_value)
    values (v_org, null, 'invoice', c_last_invoice);
  end if;

  update public.document_number_sequences
     set current_value = c_last_credit, updated_at = now()
   where organization_id = v_org and branch_id is null and document_kind = 'credit_note';
  if not found then
    insert into public.document_number_sequences (organization_id, branch_id, document_kind, current_value)
    values (v_org, null, 'credit_note', c_last_credit);
  end if;

  insert into public.audit_log (organization_id, action_type, module, entity_title, details)
  values (v_org, 'update', 'billing', 'ترقيم الفواتير',
          format('الفاتورة التالية %s-%s والإشعار الدائن التالي %s-%s — استمرارًا لترقيم Kizen',
                 c_inv_prefix, c_last_invoice + 1, c_cn_prefix, c_last_credit + 1));
end $$;

commit;

-- ── معاينة: ما الذي سيصدر تاليًا ─────────────────────────────────────────────
select
  case s.document_kind when 'invoice' then 'الفاتورة التالية'
                       when 'credit_note' then 'الإشعار الدائن التالي' end         as "المستند",
  case s.document_kind when 'invoice' then v.invoice_number_prefix
                       else v.credit_note_prefix end || '-' || (s.current_value + 1) as "الرقم",
  (select count(*) from public.sales_invoices i
    where i.organization_id = s.organization_id and i.issued_at is not null
      and case s.document_kind when 'invoice'
               then coalesce(i.document_type, 'simplified') not in ('credit_note', 'debit_note')
               else i.document_type = 'credit_note' end)                          as "صادر في ZainCare حتى الآن"
  from public.document_number_sequences s
  join public.organization_vat_settings v on v.organization_id = s.organization_id
  join public.organizations o on o.id = s.organization_id
 where o.name = 'مجمع أسناني المتميز الطبي'
   and s.branch_id is null
   and s.document_kind in ('invoice', 'credit_note')
 order by s.document_kind desc;
