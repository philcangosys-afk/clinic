-- ============================================================================
-- FIX — إعادة فتح اليومية رقم 1 (01/10/2026) بعد إقفالها خطأً
-- ----------------------------------------------------------------------------
-- ما حدث: ضُبطت نهاية اليوم 10:30 صباحًا بدل 10:30 مساءً، فحُسب موعد إقفال
-- اليومية المفتوحة 10:30 ص (في الماضي) فأُقفلت تلقائيًا، ثمّ فُتحت يومية رقم 2.
--
-- ما يفعله (في معاملة واحدة، يُلغى كلّه عند أيّ خطأ):
--   1) يتحقّق أنّ ضبط اليومية صار صحيحًا (موعد الإقفال المحسوب بعد الآن).
--   2) اليومية رقم 2 لنفس التاريخ: إن لم تكن عليها أيّ فاتورة ولا سند (بأيّ
--      حالة، حتى المسودّات) تُحذف، ثمّ تُعاد اليومية 1 مفتوحة بموعد إقفال
--      نهاية اليوم المضبوطة (22:30).
--      وإن كان عليها شيء فلا يُحذف ولا يُنقل شيء: تبقى اليومية 2 هي المفتوحة
--      بموعد 22:30، ويُصحَّح وقت إقفال اليومية 1 إلى لحظة فتح اليومية 2.
--   3) سطر في سجلّ التدقيق.
-- لا يمسّ أيّ فاتورة ولا سند ولا ZATCA. يُشغَّل مرّة واحدة من SQL Editor.
-- ============================================================================

do $$
declare
  v_d1      record;
  v_d2      record;
  v_set     record;
  v_close   timestamptz;
  v_inv     integer := 0;
  v_vch     integer := 0;
  v_n       integer;
  v_msg     text;
begin
  select count(*) into v_n
    from business_days
   where business_date = date '2026-10-01' and day_number = 1;
  if v_n <> 1 then
    raise exception 'توقّف: وُجدت % يومية برقم 1 بتاريخ 2026-10-01 (المتوقّع 1)', v_n;
  end if;

  select * into v_d1
    from business_days
   where business_date = date '2026-10-01' and day_number = 1
   for update;

  select * into v_set from business_day_settings where organization_id = v_d1.organization_id;
  if not found then
    raise exception 'توقّف: لا يوجد ضبط لليومية لهذه المنشأة';
  end if;

  select w.closes_at into v_close
    from app_business_day_window(
           v_d1.organization_id,
           ((v_d1.business_date + v_set.day_start) at time zone v_set.timezone)) w;

  if v_close is null or v_close <= now() then
    raise exception 'توقّف: ضبط اليومية الحالي (من % إلى %) يجعل موعد الإقفال % — صحّح «ضبط اليومية» إلى 22:30 أوّلًا ثمّ أعد التشغيل',
      to_char(v_set.day_start, 'HH24:MI'), to_char(v_set.day_end, 'HH24:MI'),
      coalesce(to_char(v_close at time zone v_set.timezone, 'YYYY-MM-DD HH24:MI'), 'غير محدّد');
  end if;

  -- اليومية رقم 2 لنفس المنشأة والتاريخ والفرع (إن وُجدت)
  select * into v_d2
    from business_days
   where organization_id = v_d1.organization_id
     and business_date = v_d1.business_date
     and day_number = 2
     and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_d1.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
   for update;

  if v_d2.id is not null then
    select count(*) into v_inv from sales_invoices     where business_day_id = v_d2.id;
    select count(*) into v_vch from financial_vouchers where business_day_id = v_d2.id;
  end if;

  -- لا يومية مفتوحة أخرى غير رقم 2 لنفس الفرع (وإلّا يرفض الفهرس الفتح)
  select count(*) into v_n
    from business_days
   where organization_id = v_d1.organization_id
     and closed_at is null
     and id <> v_d1.id
     and id is distinct from v_d2.id
     and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_d1.branch_id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_n > 0 then
    raise exception 'توقّف: توجد يومية مفتوحة أخرى غير رقم 2 لهذا الفرع';
  end if;

  if v_d2.id is null or (v_inv = 0 and v_vch = 0) then
    if v_d2.id is not null then
      delete from business_days where id = v_d2.id;
    end if;

    update business_days
       set closed_at = null,
           closed_by = null,
           auto_closed = false,
           scheduled_close_at = v_close,
           note = case when note = 'أُقفلت تلقائيًا عند نهاية يوم العمل المضبوطة' then null else note end
     where id = v_d1.id;

    v_msg := format('أُعيد فتح اليومية رقم 1 (أُقفلت خطأً 10:30 ص بسبب ضبط النهاية)، وموعد إقفالها %s%s',
                    to_char(v_close at time zone v_set.timezone, 'YYYY-MM-DD HH24:MI'),
                    case when v_d2.id is not null then ' — وحُذفت اليومية رقم 2 الفارغة' else '' end);
  else
    update business_days
       set scheduled_close_at = v_close
     where id = v_d2.id and closed_at is null;

    update business_days
       set closed_at = v_d2.opened_at
     where id = v_d1.id;

    v_msg := format('اليومية رقم 2 عليها %s فاتورة و%s سند فلم تُحذف؛ بقيت المفتوحة حتى %s، وصُحّح وقت إقفال اليومية 1 إلى لحظة فتح اليومية 2',
                    v_inv, v_vch, to_char(v_close at time zone v_set.timezone, 'YYYY-MM-DD HH24:MI'));
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, branch_id)
  values (v_d1.organization_id, null, 'billing', 'update', v_d1.id,
          'تصحيح إقفال اليومية', v_msg, v_d1.branch_id);

  raise notice '%', v_msg;
end;
$$;

-- النتيجة
select d.day_number                                         as "رقم اليومية",
       d.business_date                                      as "يوم العمل",
       to_char(d.opened_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')          as "فُتحت",
       coalesce(to_char(d.closed_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'), 'مفتوحة') as "أُقفلت",
       to_char(d.scheduled_close_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') as "موعد الإقفال",
       (select count(*) from sales_invoices i where i.business_day_id = d.id)          as "الفواتير",
       (select count(*) from financial_vouchers v where v.business_day_id = d.id)      as "السندات"
  from business_days d
 where d.business_date >= date '2026-10-01'
 order by d.day_number;
