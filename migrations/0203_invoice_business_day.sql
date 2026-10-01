-- ============================================================================
-- 0203 — كلّ مستندٍ ماليّ في يوميةٍ: الإشعار الدائن والمسوّدات تظهر في الفوترة
-- ============================================================================
--
-- العَرَض: «صدر الإشعار كمسوّدة — راجع بنوده ثم أصدره»، ثمّ لا يظهر الإشعار في
-- شاشة الفوترة، لا في «مسوّدة» ولا في غيرها.
--
-- السبب: قائمة الفوترة تعرض فواتير اليوميات المختارة (ربطٌ إلزاميّ بـ
-- `business_days`). و`business_day_id` لا يكتبه إلّا `app_create_sales_invoice`
-- في آخرها. أمّا الإشعار الدائن والمدين (`app_create_credit_note`) ومسوّدة
-- الزيارة والباقة فتُدرَج بلا يومية — فلا تظهر في القائمة، ولا تُصدَر منها،
-- ولا تدخل جرد اليومية حتى بعد إصدارها.
--
-- الإصلاح:
--   ١) مُحفِّزٌ على `sales_invoices`:
--        * عند الإدراج بيد موظّف (`auth.uid()` موجود) بلا يومية ⇒ اليومية
--          المفتوحة لفرعه (أو تُفتح كما يفتحها أيّ إصدار).
--        * عند إصدار مسوّدة (draft ⇒ صادرة) ⇒ يومية **لحظة الإصدار**: المستند
--          يُحسب في اليوم الذي صدر فيه لا اليوم الذي أُنشئت فيه مسوّدته.
--      حجز الموقع العامّ (بلا مستخدم) لا يفتح يوميةً ليلًا؛ يأخذها عند إصداره.
--   ٢) تعبئة ما سبق: المسوّدات القائمة ⇒ اليومية المفتوحة؛ والصادرة بلا يومية
--      ⇒ يومية تاريخ إصدارها إن وُجدت (ولا تُفتح يومية قديمة).
--
-- لا يمسّ مبلغًا ولا رقمًا ولا ZATCA. آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

create or replace function app_stamp_invoice_business_day()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch uuid;
begin
  if tg_op = 'INSERT' then
    if new.business_day_id is not null or auth.uid() is null then
      return new;
    end if;
  elsif not (old.status = 'draft'
             and old.issued_at is null
             and new.issued_at is not null
             and new.status is distinct from 'draft') then
    return new;
  end if;

  v_branch := new.branch_id;
  if v_branch is null and new.clinic_id is not null then
    select c.branch_id into v_branch from clinics c where c.id = new.clinic_id;
  end if;

  new.business_day_id := app_ensure_business_day(new.organization_id, v_branch);
  return new;
end;
$$;

comment on function app_stamp_invoice_business_day() is
  'يومية المستند الماليّ: عند الإدراج بيد موظّف، وعند إصدار المسوّدة (يومية لحظة الإصدار). 0203.';

drop trigger if exists trg_stamp_invoice_business_day on sales_invoices;
create trigger trg_stamp_invoice_business_day
  before insert or update on sales_invoices
  for each row execute function app_stamp_invoice_business_day();

-- ── تعبئة ما سبق ────────────────────────────────────────────────────────────
do $$
declare
  v_drafts int;
  v_issued int;
  v_left   int;
begin
  -- المسوّدات المعلّقة ⇒ اليومية المفتوحة لفرعها
  update sales_invoices i
     set business_day_id = app_ensure_business_day(
           i.organization_id,
           coalesce(i.branch_id, (select c.branch_id from clinics c where c.id = i.clinic_id)))
   where i.business_day_id is null
     and i.status = 'draft';
  get diagnostics v_drafts = row_count;

  -- الصادرة بلا يومية ⇒ يومية تاريخ إصدارها في الفرع نفسه، إن كانت موجودة
  update sales_invoices i
     set business_day_id = d.id
    from business_days d
   where i.business_day_id is null
     and i.issued_at is not null
     and i.status <> 'draft'
     and d.organization_id = i.organization_id
     and coalesce(d.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(i.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and d.business_date = (select w.business_date
                              from app_business_day_window(i.organization_id, i.issued_at) w);
  get diagnostics v_issued = row_count;

  select count(*) into v_left
    from sales_invoices
   where business_day_id is null and not coalesce(is_temporary, false);

  raise notice '0203: مسوّدات نُسبت إلى اليومية المفتوحة: % — مستندات صادرة نُسبت إلى يومية إصدارها: % — بقيت بلا يومية: %',
    v_drafts, v_issued, v_left;
end $$;

commit;
