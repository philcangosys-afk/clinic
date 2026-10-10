-- ============================================================================
-- 0236_invoice_doctor_fix_day_user_filter.sql
--   تصحيح طبيب الفاتورة · وفلتر المستخدم في اليوميات يعرض فواتيره وحده
-- ============================================================================
-- طلبا المالك (10/10/2026):
--
-- ١) «إذا اختير اسم طبيب خاطئ في الفاتورة نستطيع أن نعدّله — للاستقبال والأدمن
--    الرئيسي».
--    `app_correct_invoice_doctor(فاتورة، طبيب، سبب)`: يغيّر طبيب الفاتورة،
--    وطبيب سندات قبضها التي كانت على الطبيب القديم، بسببٍ مكتوب وسطرٍ في
--    سجلّ التدقيق. الطبيب لا يدخل مستند ZATCA ولا مبالغ الفاتورة ولا رمزها،
--    فلا يمسّ التصحيح الإبلاغ. بنود الفاتورة لا طبيب عليها (الحقل فارغ في
--    كلّ البنود) فلا تُلمس، وحرّاس الفاتورة الصادرة على المبالغ تبقى كما هي.
--    لمن: المالك، ومدير المنشأة، والاستقبال. ولا على فاتورة ملغاة، ولا إلى
--    طبيبٍ معطَّل أو من منشأةٍ أخرى.
--
-- ٢) «في اليوميات السابقة اخترت ولاء فيظهر: بشاير، ولاء — يجب أن يظهر المستخدم
--    المختار وحده بفواتيره التي أصدرها».
--    `app_business_day_history` بمستخدمٍ مختار تعرض الآن **أرقامه هو**: عمود
--    «أصدر فواتيرها» باسمه وحده، وعدد فواتيره وصافيها، والمحصَّل عليها في تلك
--    اليومية، وغير المحصَّل منها. وبلا مستخدم تبقى أرقام اليومية كاملة كما كانت.
--    و`v_business_day_invoices` يُضاف إليه `issued_by` (في آخر الأعمدة) ليُفلتر
--    جدول فواتير اليومية بالمُصدِر.
--
-- آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── ١) تصحيح طبيب الفاتورة ─────────────────────────────────────────────────
create or replace function public.app_correct_invoice_doctor(
  p_invoice_id uuid,
  p_doctor_id  uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv      record;
  v_new_name text;
  v_new_org  uuid;
  v_enabled  boolean;
  v_old_name text;
  v_vouchers int;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'اكتب سبب تصحيح الطبيب';
  end if;

  select id, organization_id, branch_id, invoice_number, doctor_id, status
    into v_inv
    from sales_invoices
   where id = p_invoice_id
   for update;
  if not found then
    raise exception 'الفاتورة غير موجودة';
  end if;

  if not app_has_role(v_inv.organization_id, array['owner', 'organization_admin', 'receptionist']) then
    raise exception 'تصحيح طبيب الفاتورة للاستقبال وإدارة المنشأة';
  end if;

  if v_inv.status = 'void' then
    raise exception 'الفاتورة ملغاة — لا يُصحَّح طبيبها';
  end if;

  select name_ar, organization_id, coalesce(is_enabled, false)
    into v_new_name, v_new_org, v_enabled
    from doctors
   where id = p_doctor_id;
  if v_new_org is distinct from v_inv.organization_id then
    raise exception 'الطبيب غير موجود في هذه المنشأة';
  end if;
  if not v_enabled then
    raise exception 'الطبيب «%» معطَّل — فعِّله أوّلًا', v_new_name;
  end if;
  if v_inv.doctor_id = p_doctor_id then
    raise exception '«%» هو طبيب الفاتورة الحالي', v_new_name;
  end if;

  select name_ar into v_old_name from doctors where id = v_inv.doctor_id;

  update sales_invoices
     set doctor_id = p_doctor_id
   where id = p_invoice_id;

  -- سندات القبض المرتبطة التي حملت الطبيب القديم (أو لا طبيب) تتبعه
  update financial_vouchers
     set doctor_id = p_doctor_id
   where related_sales_invoice_id = p_invoice_id
     and doctor_id is not distinct from v_inv.doctor_id;
  get diagnostics v_vouchers = row_count;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_inv.organization_id, v_inv.branch_id, auth.uid(), 'billing', 'update', v_inv.id,
          'تصحيح طبيب الفاتورة ' || v_inv.invoice_number::text,
          format('%s ← %s · سندات قبض تبعته: %s', coalesce(v_old_name, 'بلا طبيب'), v_new_name, v_vouchers),
          btrim(p_reason));
end $$;

revoke all on function public.app_correct_invoice_doctor(uuid, uuid, text) from public, anon;
grant execute on function public.app_correct_invoice_doctor(uuid, uuid, text) to authenticated;

comment on function public.app_correct_invoice_doctor(uuid, uuid, text) is
  'تصحيح طبيب الفاتورة (وسندات قبضها التي على الطبيب القديم) بسببٍ وتدقيق — للمالك ومدير المنشأة والاستقبال. لا يمسّ المبالغ ولا ZATCA. 0236.';

-- ── ٢) مُصدِر الفاتورة في فواتير اليومية ───────────────────────────────────
create or replace view public.v_business_day_invoices as
select i.business_day_id,
       i.organization_id,
       i.id as invoice_id,
       i.invoice_number,
       i.created_at,
       i.status,
       i.is_temporary,
       i.invoice_type,
       i.net_amount,
       i.paid_amount,
       i.remaining_amount,
       p.name_ar as patient_name,
       p.file_number,
       i.external_customer_name,
       d.name_ar as doctor_name,
       -- 0236: من أصدر الفاتورة — في آخر الأعمدة
       i.created_by as issued_by
  from sales_invoices i
  left join patients p on p.id = i.patient_id
  left join doctors d on d.id = i.doctor_id
 where i.business_day_id is not null;

alter view public.v_business_day_invoices set (security_invoker = on);
grant select on public.v_business_day_invoices to authenticated;

-- ── ٣) سجلّ اليوميات: أرقام المستخدم المختار وحده ──────────────────────────
create or replace function public.app_business_day_history(
  p_organization_id uuid,
  p_from            date default null,
  p_to              date default null,
  p_user_id         uuid default null
)
returns table (
  business_day_id      uuid,
  day_number           bigint,
  business_date        date,
  opened_at            timestamptz,
  closed_at            timestamptz,
  is_open              boolean,
  auto_closed          boolean,
  opened_by_name       text,
  closed_by_name       text,
  issuers              text,
  invoices_count       bigint,
  net_amount           numeric,
  net_collected_amount numeric,
  outstanding_amount   numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_organization_id, 'billing.day_history') then
    raise exception 'صلاحيتك لا تسمح بعرض اليوميات السابقة (billing.day_history)';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'تاريخ «إلى» قبل تاريخ «من»';
  end if;

  -- بلا مستخدم: اليومية كاملة كما في 0191
  if p_user_id is null then
    return query
    select s.business_day_id,
           s.day_number::bigint,
           s.business_date,
           s.opened_at,
           s.closed_at,
           s.is_open,
           coalesce(s.auto_closed, false),
           case when d.opened_by is null then null else app_member_user_name(d.organization_id, d.opened_by) end,
           case when d.closed_by is null then null else app_member_user_name(d.organization_id, d.closed_by) end,
           (select string_agg(n, '، ' order by n)
              from (select distinct app_member_user_name(d.organization_id, i.created_by) as n
                      from sales_invoices i
                     where i.business_day_id = d.id
                       and i.created_by is not null) x
             where n is not null),
           s.invoices_count::bigint,
           s.net_amount::numeric,
           s.net_collected_amount::numeric,
           s.outstanding_amount::numeric
      from v_business_day_summary s
      join business_days d on d.id = s.business_day_id
     where d.organization_id = p_organization_id
       and (p_from is null or d.business_date >= p_from)
       and (p_to   is null or d.business_date <= p_to)
     order by d.business_date desc, d.day_number desc
     limit 500;
    return;
  end if;

  -- بمستخدم: يومياته (فتحها أو أقفلها أو أصدر فيها)، وأرقامه هو وحده:
  -- فواتيره في اليومية، والمقبوض عليها في اليومية نفسها، والباقي منها.
  return query
  select d.id,
         d.day_number::bigint,
         d.business_date,
         d.opened_at,
         d.closed_at,
         (d.closed_at is null),
         coalesce(d.auto_closed, false),
         case when d.opened_by is null then null else app_member_user_name(d.organization_id, d.opened_by) end,
         case when d.closed_by is null then null else app_member_user_name(d.organization_id, d.closed_by) end,
         case when coalesce(inv.cnt, 0) > 0 then app_member_user_name(d.organization_id, p_user_id) end,
         coalesce(inv.cnt, 0)::bigint,
         coalesce(inv.net, 0)::numeric,
         coalesce(vch.collected, 0)::numeric,
         (coalesce(inv.net, 0) - coalesce(vch.collected, 0))::numeric
    from business_days d
    left join lateral (
      select count(*) as cnt, sum(i.net_amount) as net
        from sales_invoices i
       where i.business_day_id = d.id
         and i.created_by = p_user_id
         and i.status <> 'void'
         and not coalesce(i.is_temporary, false)
    ) inv on true
    left join lateral (
      select sum(case when v.voucher_type = 'receipt' then v.amount else -v.amount end) as collected
        from financial_vouchers v
        join sales_invoices i on i.id = v.related_sales_invoice_id
       where v.business_day_id = d.id
         and not coalesce(v.is_void, false)
         and i.created_by = p_user_id
         and i.status <> 'void'
         and not coalesce(i.is_temporary, false)
    ) vch on true
   where d.organization_id = p_organization_id
     and (p_from is null or d.business_date >= p_from)
     and (p_to   is null or d.business_date <= p_to)
     and (d.opened_by = p_user_id
          or d.closed_by = p_user_id
          or exists (select 1 from sales_invoices i
                      where i.business_day_id = d.id
                        and i.created_by = p_user_id))
   order by d.business_date desc, d.day_number desc
   limit 500;
end $$;

revoke all on function public.app_business_day_history(uuid, date, date, uuid) from public, anon;
grant execute on function public.app_business_day_history(uuid, date, date, uuid) to authenticated;

commit;
