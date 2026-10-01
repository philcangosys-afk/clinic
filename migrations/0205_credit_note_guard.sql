-- ============================================================================
-- 0205 — إشعارٌ دائن واحد لكلّ ما يُرتجع: لا تكرار، ولا مرتجع يُحسب دَينًا
-- ============================================================================
--
-- العَرَض: ثلاثة إشعارات دائنة (#4 و#5 و#6) على الفاتورة نفسها بالمبلغ نفسه.
--
-- السبب، من جهتين:
--   * قبل 0203 لم يكن الإشعار يظهر في الفوترة، فضُغط «إشعار دائن» ثلاث مرّات
--     وكلّ ضغطة أنشأت مسوّدة.
--   * **ولا شيء كان يمنع ذلك:** `app_create_credit_note` تُرجع الفاتورة كاملةً
--     في كلّ مرّة، ولا تنظر فيما أُرجع منها قبل — فيمكن إرجاع فاتورةٍ بـ402.50
--     ثلاث مرّات بـ1207.50.
--
-- ما يضيفه:
--   ١) `sales_invoice_items.corrects_item_id` — بند الإشعار يشير إلى بند
--      الفاتورة الذي يصحّحه. وتُعبَّأ للإشعارات القائمة بمطابقة الصنف والوصف
--      والسعر.
--   ٢) `app_create_credit_note`: الكمية القابلة للإرجاع من كلّ بند = كميّته −
--      ما في الإشعارات الدائنة غير الملغاة عليه (والمسوّدة منها تُحسب: هي
--      إرجاعٌ قيد الإصدار) − ما في فواتير المرتجع القديمة. فإن لم يبقَ شيء
--      رُفض الطلب، والرسالة تذكر الإشعار الموجود. وينقل الإشعار جنسية الفاتورة.
--   ٣) `v_patient_balance`: المرتجع والإشعار الدائن لا يُحسبان ذمّةً على
--      المريض (كان الإشعار الصادر غير المسدَّد يظهر دَينًا بقيمته).
--
-- المسوّدة الزائدة لا تُحذف: تُلغى من شاشة الفوترة (إلغاء المسوّدة)، فيعود
-- البند قابلًا للإرجاع.
--
-- آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- ١) بند الإشعار ← بند الفاتورة
-- ---------------------------------------------------------------------------
alter table sales_invoice_items
  add column if not exists corrects_item_id uuid references sales_invoice_items(id);

create index if not exists idx_sales_invoice_items_corrects_item
  on sales_invoice_items (corrects_item_id) where corrects_item_id is not null;

comment on column sales_invoice_items.corrects_item_id is
  'بند الفاتورة الأصلية الذي يصحّحه بند الإشعار الدائن أو المدين. به يُحسب ما بقي قابلًا للإرجاع. 0205.';

-- تعبئة الإشعارات القائمة: أوّل بندٍ في الفاتورة الأصلية بالصنف والوصف والسعر نفسها
update sales_invoice_items n
   set corrects_item_id = (
         select o.id
           from sales_invoice_items o
          where o.invoice_id = s.corrects_invoice_id
            and o.item_id is not distinct from n.item_id
            and coalesce(o.description, '') = coalesce(n.description, '')
            and o.price = n.price
          order by o.created_at, o.id
          limit 1)
  from sales_invoices s
 where s.id = n.invoice_id
   and s.document_type in ('credit_note', 'debit_note')
   and s.corrects_invoice_id is not null
   and n.corrects_item_id is null;

-- ---------------------------------------------------------------------------
-- ٢) الإشعار الدائن بما بقي قابلًا للإرجاع وحده
-- ---------------------------------------------------------------------------
/**
 * منسوخة من 0202، والتغيير:
 *   * لكلّ بند: المُرتجَع سابقًا = كمية بنود الإشعارات الدائنة غير الملغاة
 *     المشيرة إليه (مسوّدةً أو صادرة) + كمية بنود فواتير المرتجع القديمة
 *     (`invoice_type = 'return'` من «إنشاء مرتجع» قبل 0205) بالصنف أو الوصف.
 *     والكمية المأخوذة لا تتجاوز الباقي؛ وإن لم يبقَ شيء في الفاتورة كلّها
 *     رُفض الطلب برسالة تذكر الإشعارات الموجودة.
 *   * بند الإشعار يحمل `corrects_item_id`، والإشعار يحمل جنسية الفاتورة.
 * والإشعار المدين (زيادة) لا يُقيَّد بالمرتجع.
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
  v_inv      sales_invoices%rowtype;
  v_note     uuid;
  v_line     record;
  v_qty      numeric;
  v_left     numeric;
  v_disc     numeric;
  v_base     numeric;
  v_lvat     numeric;
  v_sub      numeric := 0;
  v_dsum     numeric := 0;
  v_vat      numeric := 0;
  v_exm      numeric := 0;
  v_n        int := 0;
  v_existing text;
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
  if v_inv.status = 'void' then
    raise exception 'الفاتورة ملغاة — لا إشعار على فاتورةٍ ملغاة';
  end if;
  if v_inv.document_type in ('credit_note', 'debit_note') or v_inv.invoice_type = 'return' then
    raise exception 'الإشعار يصدر على فاتورة بيع لا على إشعارٍ أو مرتجع';
  end if;
  if p_note_type not in ('credit_note','debit_note') then
    raise exception 'نوع الإشعار غير معروف';
  end if;

  insert into sales_invoices (
    organization_id, branch_id, clinic_id, doctor_id, patient_id, visit_id,
    invoice_type, document_type, status, corrects_invoice_id, note_type, note_reason,
    external_customer_name, id_number, is_insurance_invoice, created_by,
    is_b2b, external_client_id, nationality_value_id)
  values (
    v_inv.organization_id, v_inv.branch_id, v_inv.clinic_id, v_inv.doctor_id,
    v_inv.patient_id, v_inv.visit_id,
    case when p_note_type = 'credit_note' then 'return' else 'sale' end,
    p_note_type, 'draft', p_invoice_id, p_note_type, btrim(p_reason),
    v_inv.external_customer_name, v_inv.id_number, v_inv.is_insurance_invoice, auth.uid(),
    coalesce(v_inv.is_b2b, false), v_inv.external_client_id, v_inv.nationality_value_id)
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
     order by li.created_at, li.id
  loop
    v_qty := least(coalesce(v_line.take_qty, v_line.qty), v_line.qty);

    if p_note_type = 'credit_note' then
      -- الباقي القابل للإرجاع من هذا البند
      v_left := v_line.qty
        - coalesce((select sum(n.qty)
                      from sales_invoice_items n
                      join sales_invoices s on s.id = n.invoice_id
                     where n.corrects_item_id = v_line.id
                       and s.document_type = 'credit_note'
                       and s.status <> 'void'
                       and s.id <> v_note), 0)
        - coalesce((select sum(n.qty)
                      from sales_invoice_items n
                      join sales_invoices s on s.id = n.invoice_id
                     where s.original_invoice_id = p_invoice_id
                       and s.invoice_type = 'return'
                       and s.document_type not in ('credit_note', 'debit_note')
                       and s.status <> 'void'
                       and (case when v_line.item_id is not null
                                 then n.item_id = v_line.item_id
                                 else n.item_id is null
                                      and coalesce(n.description, '') = coalesce(v_line.description, '') end)), 0);
      v_qty := least(v_qty, greatest(v_left, 0));
    end if;
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
      zatca_exemption_code, corrects_item_id,
      taxable_base, item_name_snapshot, unit_snapshot, source_type)
    values (
      v_note, v_line.item_id, v_line.doctor_id, v_line.description, v_line.line_type,
      v_line.price, v_qty,
      v_disc, case when v_disc > 0 then coalesce(v_line.discount_reason, 'خصم البند في الفاتورة الأصلية') end,
      v_line.vat_rate, v_lvat,
      case when coalesce(v_line.exemption_amount, 0) > 0 then v_base else 0 end,
      v_base + v_lvat,
      v_line.vat_category, v_line.exemption_reason,
      v_line.zatca_exemption_code, v_line.id,
      v_base, v_line.item_name_snapshot, v_line.unit_snapshot,
      'manual');

    v_sub  := v_sub + round(v_line.price * v_qty, 2);
    v_dsum := v_dsum + v_disc;
    v_vat  := v_vat + v_lvat;
    v_exm  := v_exm + case when coalesce(v_line.exemption_amount, 0) > 0 then v_base else 0 end;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    if p_note_type = 'credit_note' then
      select string_agg(
               coalesce(nullif(s.document_prefix, '') || '-' || s.document_number::text,
                        '#' || s.invoice_number::text)
               || case when s.status = 'draft' then ' (مسوّدة)' else '' end,
               '، ' order by s.created_at)
        into v_existing
        from sales_invoices s
       where s.corrects_invoice_id = p_invoice_id
         and s.document_type = 'credit_note'
         and s.status <> 'void'
         and s.id <> v_note;
      raise exception 'بنود هذه الفاتورة مُرتجعة كلّها%', case when v_existing is null then ''
        else ' في: ' || v_existing || ' — أصدر الإشعار الموجود، أو ألغِ المسوّدة الزائدة ثمّ أعد المحاولة' end;
    end if;
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
          format('على الفاتورة %s بـ%s بندًا', coalesce(v_inv.document_number, v_inv.invoice_number), v_n),
          btrim(p_reason));

  return v_note;
end;
$$;

-- ---------------------------------------------------------------------------
-- ٣) المرتجع ليس ذمّة على المريض
-- ---------------------------------------------------------------------------
-- منسوخ من 0144، والتغيير: `invoice_type = 'return'` (المرتجع والإشعار
-- الدائن) لا يدخل «المستحقّ» ولا «الفواتير المفتوحة». ما يُردّ للمريض يُسجَّل
-- سند صرفٍ من «استرداد» على فاتورته الأصلية.
create or replace view v_patient_balance as
select
  p.id as patient_id,
  p.organization_id,
  p.name_ar as patient_name,
  p.file_number,
  coalesce(sum(i.net_amount) filter (
    where i.status <> all (array['void','draft']) and coalesce(i.is_temporary, false) = false
  ), 0) as total_billed,
  coalesce(sum(i.paid_amount) filter (
    where i.status <> all (array['void','draft']) and coalesce(i.is_temporary, false) = false
  ), 0) as total_paid,
  coalesce(sum(i.refunded_amount) filter (
    where i.status <> all (array['void','draft']) and coalesce(i.is_temporary, false) = false
  ), 0) as total_refunded,
  coalesce(sum(i.remaining_amount) filter (
    where i.status = any (array['unpaid','partial']) and coalesce(i.is_temporary, false) = false
      and i.invoice_type <> 'return'
  ), 0) as balance_due,
  count(i.id) filter (
    where i.status = any (array['unpaid','partial']) and coalesce(i.is_temporary, false) = false
      and i.invoice_type <> 'return'
  ) as open_invoices,
  max(i.issued_at) filter (where coalesce(i.is_temporary, false) = false) as last_invoice_at
from patients p
left join sales_invoices i on i.patient_id = p.id
group by p.id, p.organization_id, p.name_ar, p.file_number;
alter view v_patient_balance set (security_invoker = on);

commit;

notify pgrst, 'reload schema';
