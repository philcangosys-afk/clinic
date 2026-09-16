-- ---------------------------------------------------------------------------
-- 0162_patient_invoices_and_payments.sql — شاشة فواتير المريض وشبكة الدفعات
-- ---------------------------------------------------------------------------
-- ثلاث نقائص تعالجها هذه الترقية:
--
--   • **فواتير المريض بلا مجاميع.** الشاشة تسرد الفواتير ولا تقول: كم قبل
--     الخصم، كم الخصومات، كم نسبتها، كم المدفوع، كم نسبة التحصيل، كم المتبقّي.
--     فيُخرج الموظّف الأرقام إلى ورقة ويجمعها بيده — وكلّ جمعٍ بيدٍ خطأٌ ينتظر.
--     الجمع في المتصفّح ليس حلًّا: القائمة محدودة بـ30 صفًّا، فيجمع الظاهر لا
--     الكلّ، ويخرج رقمٌ يبدو صحيحًا وهو ناقص.
--
--   • **الدفعات بلا هويّة.** شبكة الدفعات في نظام العيادات المرجعيّ تقول لكل
--     دفعة: رقم السند، تاريخه، نوعه، الحساب (الصندوق)، الطبيب، المستخدم،
--     القيمة، الجهاز، الملاحظة. وشاشتنا تعرض الرقم والتاريخ والطريقة فقط —
--     فإذا اختلّ الصندوق آخر اليوم لا يُعرف مَن قبض ولا من أيّ جهاز.
--
--   • **سندات المال بلا تدقيق.** 0025 ربط مُحفِّز التدقيق بأحد عشر جدولًا
--     ليس فيها `financial_vouchers` — أي أنّ **حركة النقد وحدها غير مُدقَّقة**
--     بينما المريض والطبيب والفاتورة مُدقَّقون. وهذا هو مصدر «اسم الجهاز»
--     أيضًا (`audit_log.device_name` منذ 0043). فيُربط المُحفِّز هنا.
--
-- **اسم الجهاز يظهر للسندات المُنشأة بعد هذه الترقية فقط.** ما قبلها لا أثر
-- له في `audit_log`، ويظهر «—». لا يُخترع له اسم.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) تدقيق سندات المال
--
-- `voucher_number` هو عنوان السطر في سجلّ التدقيق — كما `invoice_number`
-- للفاتورة في 0025. والمُحفِّز `after` لا `before`: لا يمنع ولا يعدّل، يسجّل.
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists trg_audit_financial_vouchers on financial_vouchers;
create trigger trg_audit_financial_vouchers
  after insert or update or delete on financial_vouchers
  for each row execute function app_audit_log_auto('voucher_number');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) دفعات الفاتورة — صفٌّ لكل تخصيصٍ من سند إلى فاتورة
--
-- المصدر `voucher_invoice_allocations` لا `financial_vouchers.related_sales_invoice_id`:
-- السند الواحد قد يوزَّع على فواتير، والعمود المفرد يعرف واحدة. وهذا هو
-- المصدر نفسه الذي تحسب منه `app_recalc_invoice_payment_status` المدفوع —
-- فلا يختلف مجموع الشبكة عن «المدفوع» في الترويسة.
--
-- **الإشارة:** سند القبض موجب وسند الصرف (الاسترداد) سالب. عرضهما بإشارةٍ
-- واحدة يجعل مريضًا استُرِدّ له مبلغٌ يبدو وكأنّه دفع مرّتين.
--
-- **السند الملغى يبقى معروضًا** بعلامته: حذفه من الشبكة يجعل المتبقّي يقفز
-- بلا سببٍ ظاهر، والمالك يمنع الحذف النهائي للبيانات المالية.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_invoice_payments as
select
  a.id                                as allocation_id,
  a.sales_invoice_id                  as invoice_id,
  v.id                                as voucher_id,
  v.organization_id,
  v.voucher_number,
  v.voucher_date,
  v.voucher_type,
  -- نوع الحركة كما يقرؤه الموظّف، لا كما يُخزَّن
  case
    when v.refund_of_voucher_id is not null then 'استرداد'
    when v.voucher_type = 'receipt'         then 'قبض'
    when v.voucher_type = 'expense'         then 'صرف'
    else coalesce(v.voucher_type, '—')
  end                                 as movement_label,
  pm.name_ar                          as payment_method_name,
  cr.name                             as register_name,
  d.name_ar                           as doctor_name,
  u.email                             as user_email,
  -- القيمة بإشارتها: الصرف يُنقص
  case when v.voucher_type = 'expense' then -a.amount else a.amount end as amount,
  a.amount                            as allocated_amount,
  v.is_void,
  v.void_reason,
  v.refund_of_voucher_id is not null   as is_refund,
  v.bank_transfer_ref,
  v.description                       as note,
  -- اسم الجهاز: أوّل أثر إنشاءٍ لهذا السند في سجلّ التدقيق. يبقى NULL لما
  -- أُنشئ قبل ربط المُحفِّز أعلاه — وهذا صدقٌ لا نقص.
  (select al.device_name
     from audit_log al
    where al.entity_id = v.id
      and al.module = 'financial_vouchers'
      and al.action_type = 'add'
      and al.device_name is not null
    order by al.occurred_at
    limit 1)                          as device_name,
  v.created_at
from voucher_invoice_allocations a
join financial_vouchers v on v.id = a.voucher_id
left join lookup_values pm on pm.id = v.payment_method_value_id
left join cash_registers cr on cr.id = v.cash_register_id
left join doctors d on d.id = v.doctor_id
left join auth.users u on u.id = v.created_by;

alter view v_invoice_payments set (security_invoker = on);
revoke all on v_invoice_payments from anon;
grant select on v_invoice_payments to authenticated;

comment on view v_invoice_payments is
  'دفعات الفاتورة: سندٌ وتاريخٌ ونوعٌ وصندوقٌ وطبيبٌ ومستخدمٌ وقيمةٌ بإشارتها وجهازٌ وملاحظة. المصدر تخصيصات السندات نفسها التي يُحسب منها المدفوع.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) فواتير المريض — صفٌّ لكل فاتورة، بأعمالها ومبالغها
--
-- «الأعمال» أسماء الخدمات لا عددها: الموظّف يبحث بصريًّا عن «تقويم» بين عشر
-- فواتير، وعددُ البنود لا يدلّه. تُقتطع عند حدٍّ معقول لأنّ فاتورةً بثلاثين
-- بندًا تكسر الصفّ.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_patient_invoices as
select
  i.id,
  i.organization_id,
  i.branch_id,
  i.patient_id,
  i.invoice_number,
  i.invoice_type,
  i.status,
  i.is_temporary,
  i.created_at,
  i.issued_at,
  i.doctor_id,
  d.name_ar                           as doctor_name,
  c.name                              as clinic_name,
  li.lines_count,
  li.works,
  i.subtotal_amount,
  i.discount_amount,
  i.offer_percent,
  i.vat_amount,
  i.exemption_amount,
  i.net_amount,
  i.paid_amount,
  i.refunded_amount,
  coalesce(i.remaining_amount, 0)     as remaining_amount,
  i.is_insurance_invoice,
  i.insurance_company_name,
  i.patient_share_amount,
  i.insurance_share_amount,
  i.agreement_id,
  i.appointment_id,
  i.note,
  -- تصنيف المرشّحات الثلاثة في الشاشة: الكل / الآجل / المدفوع.
  -- «آجل» = عليها متبقّي وليست ملغاة ولا مؤقّتة. عرض السعر ليس دينًا.
  (coalesce(i.status, '') <> 'void'
     and coalesce(i.is_temporary, false) = false
     and coalesce(i.remaining_amount, 0) > 0)                      as is_credit,
  (coalesce(i.status, '') <> 'void'
     and coalesce(i.is_temporary, false) = false
     and coalesce(i.remaining_amount, 0) <= 0)                     as is_settled
from sales_invoices i
left join doctors d on d.id = i.doctor_id
left join clinics c on c.id = i.clinic_id
left join lateral (
  select count(*) as lines_count,
         string_agg(coalesce(nullif(btrim(x.description), ''), x.item_name_snapshot, '—'),
                    '، ' order by x.created_at) as works
    from (
      select li2.description, li2.item_name_snapshot, li2.created_at
        from sales_invoice_items li2
       where li2.invoice_id = i.id
       order by li2.created_at
       limit 8
    ) x
) li on true;

alter view v_patient_invoices set (security_invoker = on);
revoke all on v_patient_invoices from anon;
grant select on v_patient_invoices to authenticated;

comment on view v_patient_invoices is
  'فواتير المريض للشاشة: العدد والرقم والتاريخ والأعمال والإجمالي والخصومات والصافي والمدفوع والمتبقّي والطبيب، مع علمَي «آجل» و«مسدَّدة» للمرشّحات.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) مجاميع فواتير المريض — تُحسب في القاعدة على كلّ فواتيره
--
-- الشاشة تعرض ثلاثين صفًّا وتجمع المجاميع على **كلّ** الفواتير: الموظّف
-- يسأل «كم على هذا المريض» لا «كم على آخر ثلاثين فاتورة». ولو جُمعت في
-- المتصفّح لخرج رقمٌ أصغر من الحقيقة كلّما تجاوز المريض الثلاثين.
--
-- الفواتير الملغاة والمؤقّتة خارج المجاميع: الأولى لا وجود لها ماليًّا،
-- والثانية عرض سعرٍ لم يُصدر.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_patient_invoice_totals(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_scope           text default 'all'   -- all | credit | settled
)
returns table (
  invoice_count     bigint,
  before_discount   numeric,
  discount_total    numeric,
  discount_percent  numeric,
  after_discount    numeric,
  vat_total         numeric,
  paid_total        numeric,
  collection_percent numeric,
  remaining_total   numeric
)
language sql
stable
security invoker
as $$
  with rows as (
    select i.*
      from sales_invoices i
     where i.organization_id = p_organization_id
       and i.patient_id = p_patient_id
       and i.invoice_type = 'sale'
       and coalesce(i.status, '') <> 'void'
       and coalesce(i.is_temporary, false) = false
       and (
         p_scope = 'all'
         or (p_scope = 'credit'  and coalesce(i.remaining_amount, 0) > 0)
         or (p_scope = 'settled' and coalesce(i.remaining_amount, 0) <= 0)
       )
  )
  select
    count(*)                                          as invoice_count,
    coalesce(sum(subtotal_amount), 0)                 as before_discount,
    coalesce(sum(discount_amount), 0)                 as discount_total,
    -- النسبة تُحسب على ما قبل الخصم؛ القسمة على صفر تُعطى صفرًا لا خطأ
    case when coalesce(sum(subtotal_amount), 0) = 0 then 0
         else round(coalesce(sum(discount_amount), 0) * 100.0
                    / sum(subtotal_amount), 2) end    as discount_percent,
    coalesce(sum(subtotal_amount), 0)
      - coalesce(sum(discount_amount), 0)             as after_discount,
    coalesce(sum(vat_amount), 0)                      as vat_total,
    coalesce(sum(paid_amount), 0)                     as paid_total,
    case when coalesce(sum(net_amount), 0) = 0 then 0
         else round(coalesce(sum(paid_amount), 0) * 100.0
                    / sum(net_amount), 2) end         as collection_percent,
    coalesce(sum(coalesce(remaining_amount, 0)), 0)   as remaining_total
  from rows;
$$;

comment on function app_patient_invoice_totals(uuid, uuid, text) is
  'مجاميع فواتير المريض على كلّ فواتيره لا على الصفحة المعروضة: العدد وقبل الخصم والخصومات ونسبتها وبعد الخصم والضريبة والمدفوع ونسبة التحصيل والمتبقّي. تستبعد الملغاة والمؤقّتة.';

revoke all on function app_patient_invoice_totals(uuid, uuid, text) from public, anon;
grant execute on function app_patient_invoice_totals(uuid, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) اتفاقيات المريض ذات المتبقّي
--
-- تنبيه «العميل عليه إتفاقيات عليها متبقٍّ» في ذيل قائمة الأوامر يحتاج
-- إجابةً واحدة: كم اتفاقية وكم المجموع. استعلامٌ واحد بدل جلب الاتفاقيات
-- كلّها لعدّها في المتصفّح.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_patient_open_agreements as
select
  ta.organization_id,
  ta.patient_id,
  count(*)                                        as open_count,
  coalesce(sum(coalesce(ta.remaining_amount, 0)), 0) as remaining_total
from treatment_agreements ta
where coalesce(ta.is_disabled, false) = false
  and coalesce(ta.remaining_amount, 0) > 0
group by ta.organization_id, ta.patient_id;

alter view v_patient_open_agreements set (security_invoker = on);
revoke all on v_patient_open_agreements from anon;
grant select on v_patient_open_agreements to authenticated;

comment on view v_patient_open_agreements is
  'اتفاقيات المريض غير المعطَّلة التي عليها متبقٍّ: عددها ومجموعها — لتنبيه قائمة أوامر الملفّ.';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0162_patient_invoices_and_payments.sql
-- ---------------------------------------------------------------------------
