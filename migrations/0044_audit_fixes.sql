-- 0044: إصلاحات تدقيق أمني ومحاسبي على الترحيلات 0037–0043
--
-- كل بند هنا خلل مُثبَت بتنفيذ فعلي على قاعدة بيانات مطبَّق عليها كل
-- الترحيلات، لا ملاحظة نظرية. الأرقام المذكورة في التعليقات نواتج حقيقية.

-- ============================================================================
-- 1) تسريب عبر العروض: كل عرض في المشروع يعمل بصلاحيات مالكه (postgres)
--    فيتجاوز سياسات RLS للجداول التي يقرأ منها.
--
--    مُثبَت: مستخدم في المؤسسة A يقرأ `v_patient_financials` فيرى صف مريض
--    المؤسسة B وإجمالي إيراده — بينما القراءة من `sales_invoices` مباشرةً
--    تحجبه صحيحًا. أي أن العروض التي أضفناها فتحت مسارًا يلتفّ على RLS.
--
--    الحل لعرضٍ لا يمسّ جدولًا مميّزًا: `security_invoker = on` فيسري RLS
--    الخاص بالمستخدم. متاح منذ PostgreSQL 15 (Supabase يعمل على 15+).
-- ============================================================================
alter view v_inventory_on_hand set (security_invoker = on);
alter view v_inventory_warehouse_summary set (security_invoker = on);
alter view v_patient_financials set (security_invoker = on);
alter view v_patient_financials_by_doctor set (security_invoker = on);

-- ============================================================================
-- 2) `v_audit_log_detail` — أخطر ما وُجد.
--
--    مُثبَت: مستخدم في المؤسسة A يقرأ العرض بلا أي فلتر فيحصل على **سجل
--    تدقيق كل المؤسسات** إضافةً إلى **بريد كل المستخدمين** — وهو ما لا
--    يستطيع الحصول عليه بأي طريق آخر (`auth.users` ممنوعة عليه صراحةً:
--    permission denied for table users).
--
--    `security_invoker = on` **لا يصلح هنا**: العرض يقرأ `auth.users`، ومع
--    صلاحيات المستدعي يفشل الوصف كله. لذلك يبقى العرض بصلاحيات المالك ويُضاف
--    شرط العضوية داخله — فيصبح الفلتر جزءًا من تعريف العرض لا مسؤولية
--    الاستعلام كما كان يفترض 0037 خطأً (PostgREST لا يفرض فلترة العميل).
-- ============================================================================
create or replace view v_audit_log_detail as
select
  a.id,
  a.organization_id,
  a.occurred_at,
  a.user_id,
  u.email as user_email,
  a.device_name,
  a.action_type,
  a.module,
  a.entity_id,
  a.entity_title,
  a.details,
  a.reason
from audit_log a
left join auth.users u on u.id = a.user_id
where app_is_member(a.organization_id);

-- ============================================================================
-- 3) `v_daily_revenue_by_user` كان **يضاعف الإيراد**.
--
--    السبب: الربط بـ `v_organization_members_directory` على `user_id`،
--    والعرض ليس فريدًا لكل (مؤسسة، مستخدم) — لأنه يربط `doctors` و
--    `employees` على `user_id` وليس على أيٍّ منهما قيد فريد على `user_id`.
--    طبيبٌ له سجلّان (عيادتان في نفس المركز) = صفّان في الدليل.
--
--    مُثبَت: ٣ فواتير بـ 345.00 ظهرت في العرض ٦ فواتير بـ 690.00. والأسوأ أن
--    `group by display_name` يطوي الصفَّين في صف واحد، فيظهر مستخدم واحد
--    طبيعي المظهر بمبلغ مضاعف بلا صف مكرَّر ينبّه أحدًا.
--
--    الحل: الربط بـ `organization_memberships` (مفتاحها الأساسي
--    (organization_id, user_id) فلا فان-آوت ممكن)، والاسم بجملة فرعية قياسية.
--
--    وأيضًا: `v_daily_revenue` الأصلي يحسب الملغاة والمؤقتة ضمن الإيراد —
--    فالمجموعان لا يتطابقان أبدًا. صُحِّح ليطابق نفس شروط العرض الجديد.
-- ============================================================================
create or replace view v_daily_revenue_by_user as
select
  si.organization_id,
  si.created_at::date          as revenue_date,
  si.created_by                as user_id,
  coalesce(
    (select d.name_ar from doctors d
      where d.user_id = si.created_by and d.organization_id = si.organization_id
      order by d.created_at limit 1),
    (select e.name_ar from employees e
      where e.user_id = si.created_by and e.organization_id = si.organization_id
      order by e.created_at limit 1),
    'غير محدَّد'
  )                            as user_name,
  count(*)                     as invoice_count,
  sum(si.subtotal_amount)      as gross_amount,
  sum(si.discount_amount)      as discount_amount,
  sum(si.vat_amount)           as vat_amount,
  sum(si.net_amount)           as net_amount,
  sum(si.paid_amount)          as paid_amount
from sales_invoices si
where si.invoice_type = 'sale'
  and si.status <> 'void'
  and si.is_temporary = false
group by si.organization_id, si.created_at::date, si.created_by;

alter view v_daily_revenue_by_user set (security_invoker = on);

-- الفاتورة الملغاة ليست إيرادًا، والفاتورة المؤقتة (عرض سعر) لم تُصدَر بعد.
-- احتسابهما كان يضخّم إيراد اليوم في لوحة التحكم والتقارير.
create or replace view v_daily_revenue as
select
  organization_id,
  created_at::date as revenue_date,
  count(*) as invoice_count,
  sum(subtotal_amount) as gross_amount,
  sum(discount_amount) as discount_amount,
  sum(vat_amount) as vat_amount,
  sum(net_amount) as net_amount,
  sum(paid_amount) as paid_amount
from sales_invoices
where invoice_type = 'sale'
  and status <> 'void'
  and is_temporary = false
group by organization_id, created_at::date;

alter view v_daily_revenue set (security_invoker = on);

-- ============================================================================
-- 4) `app_request_device_name()` — بطء تربيعي يقوده ترويسة من العميل.
--
--    مُثبَت: ترويسة بطول 30,000 حرف حوّلت إدراج مريض واحد من 6 مللي ثانية إلى
--    **6.6 ثانية** — داخل المعاملة وهي ممسكة بأقفال الصفوف. الحدود المعتادة
--    في nginx/PostgREST تسمح بـ 8–32 كيلوبايت، فلا يحتاج المهاجم أي صلاحية
--    خاصة. السبب: `v_hex := v_hex || ...` داخل حلقة حرفًا حرفًا.
--
--    الحل: قصّ المُدخَل أولًا (اسم جهاز فوق 200 حرف لا معنى له)، ثم فكّ
--    الترميز بعملية مجموعية واحدة (`regexp_matches` + `string_agg`) بلا حلقة.
--
--    وأيضًا: `set search_path` صراحةً — بدونها كان يمكن تحويل نداء دالة داخل
--    مُحفِّز SECURITY DEFINER إلى دالة أخرى عبر مسار بحث معدَّل (مُثبَت في
--    psql: أعاد "HIJACKED: runs as postgres").
-- ============================================================================
create or replace function app_request_device_name()
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_headers text;
  v_raw text;
  v_hex text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null then
    return null;
  end if;

  begin
    v_raw := (v_headers::json ->> 'x-device-name');
  exception when others then
    -- ترويسات غير صالحة JSON يجب ألّا تمنع حفظ سجل المريض
    return null;
  end;

  if v_raw is null or v_raw = '' then
    return null;
  end if;

  -- القصّ **قبل** أي معالجة: هو الحدّ الذي يمنع الترويسة الضخمة من إبطاء
  -- كل عملية كتابة في النظام. 200 حرفًا تكفي لأي اسم جهاز معقول.
  v_raw := left(v_raw, 200);

  begin
    -- فكّ ترميز مجموعي بلا حلقة: `regexp_matches` تقسّم النص إلى وحدات
    -- (إمّا %HH أو حرف واحد) بترتيبها، و`string_agg` تجمّع الست عشري في
    -- عازل واحد — فالكلفة خطّية بدل تربيعية.
    select string_agg(
             -- شرط الطول ضروري: التعبير النمطي يُخرج '%' وحدها كحرف عادي
             -- حين لا يتبعها رقمان ست عشريان، وبلا هذا الشرط كانت تُقصّ
             -- فتختفي من الاسم ("%ZZ bad" تصير "ZZ bad").
             case when length(tok[1]) = 3 and left(tok[1], 1) = '%' then substr(tok[1], 2, 2)
                  else encode(convert_to(tok[1], 'UTF8'), 'hex') end,
             '' order by ord)
      into v_hex
      from regexp_matches(v_raw, '%[0-9A-Fa-f]{2}|.', 'g') with ordinality as t(tok, ord);
    return convert_from(decode(v_hex, 'hex'), 'UTF8');
  exception when others then
    -- ترويسة مشوّهة يجب ألّا تُفشل عملية الحفظ — الاسم الخام مقصوصًا أفضل
    -- من فقدان السجل كله.
    return left(v_raw, 100);
  end;
end;
$$;

-- ============================================================================
-- 5) قيد فريد لرقم المناقلة.
--
--    `transfer_number` كان بلا قيد فريد — والنمط الغالب في المشروع
--    (patients.file_number، offers.offer_number، dental_lab_orders...) هو
--    `unique (organization_id, <n>_number)`. بلا القيد يمكن أن يتكرّر الرقم
--    إن أُعيد ضبط المتتالية، ورقم مستند مكرَّر خطأ لا يُصلَح بأثر رجعي.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'stock_transfers'::regclass
      and conname = 'stock_transfers_org_number_key'
  ) then
    alter table stock_transfers
      add constraint stock_transfers_org_number_key unique (organization_id, transfer_number);
  end if;
end $$;

-- ============================================================================
-- 6) سياسات التخزين لا تفحص `is_active`.
--
--    كل فحص انتماء آخر في المشروع يمرّ بـ `app_is_member()` التي تشترط
--    `is_active = true`. سياسات دلو `patient-documents` في 0037 كتبت الفحص
--    يدويًا بلا هذا الشرط. الحماية اليوم عرَضية: تأتي من سياسة القراءة على
--    `organization_memberships` نفسها. مُثبَت أنه بإضافة سياسة قراءة ذاتية
--    معقولة يستعيد **موظف مُعطَّل** حق القراءة والكتابة والحذف على مستندات
--    المرضى الطبية.
-- ============================================================================
drop policy if exists "patient_documents_read_members" on storage.objects;
create policy "patient_documents_read_members" on storage.objects
  for select using (
    bucket_id = 'patient-documents'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "patient_documents_insert_members" on storage.objects;
create policy "patient_documents_insert_members" on storage.objects
  for insert with check (
    bucket_id = 'patient-documents'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "patient_documents_delete_members" on storage.objects;
create policy "patient_documents_delete_members" on storage.objects
  for delete using (
    bucket_id = 'patient-documents'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================================
-- 7) `quick_invoice_group_items` كان يقبل صنفًا من مؤسسة أخرى.
--
--    السياسة تتحقق من مؤسسة **المجموعة** ولا تتحقق من مؤسسة **الصنف**.
--    مُثبَت: مستخدم المؤسسة A أدرج صنف المؤسسة B في مجموعة المؤسسة A بنجاح.
--    ليس تسريب قراءة (RLS على `items` يحجب محتواه) لكنه صف معطوب دائمًا:
--    يظهر فارغًا في الواجهة ويحقن معرّف صنف لا يمكن حلّه في بناء الفاتورة.
-- ============================================================================
drop policy if exists "quick_invoice_group_items_all" on quick_invoice_group_items;
create policy "quick_invoice_group_items_all" on quick_invoice_group_items
  for all using (
    exists (
      select 1 from quick_invoice_groups g
      where g.id = quick_invoice_group_items.group_id
        and app_is_member(g.organization_id)
    )
  ) with check (
    exists (
      select 1
      from quick_invoice_groups g
      join items i on i.id = quick_invoice_group_items.item_id
      where g.id = quick_invoice_group_items.group_id
        and app_is_member(g.organization_id)
        -- الصنف يجب أن يكون لنفس مؤسسة المجموعة
        and i.organization_id = g.organization_id
    )
  );

-- ============================================================================
-- 8) `v_inventory_on_hand` كان يُخفي الدفعات السالبة فيضخّم الرصيد.
--
--    `inventory_lots` بلا أي قيد تحقّق، و`qty_remaining` قد يصير سالبًا عبر
--    مُحفِّز الحركات (صرف أكثر من المتاح). الشرط `qty_remaining > 0` كان
--    **يستبعد** تلك الدفعات بدل خصمها.
--
--    مُثبَت: دفعة واحدة بـ -40 جعلت الملخّص يعرض 150 والحقيقة 110.
--
--    الحل: تُحتسَب كل الدفعات في الكميات والقيم (فيظهر النقص)، ويبقى
--    استبعاد المنتهية من **متوسط التكلفة** وحده لأن دفعة برصيد صفر لا وزن
--    لها في المتوسط المرجَّح.
-- ============================================================================
create or replace view v_inventory_on_hand as
select
  lots.organization_id,
  lots.warehouse_id,
  w.name                                as warehouse_name,
  lots.item_id,
  i.code                                as item_code,
  i.name_ar                             as item_name_ar,
  i.price                               as sale_price,
  count(*) filter (where lots.qty_remaining <> 0) as lot_count,
  sum(lots.qty_remaining)               as qty_on_hand,
  sum(lots.qty_remaining * lots.unit_cost) as stock_value,
  round(
    sum(lots.qty_remaining * lots.unit_cost) filter (where lots.qty_remaining > 0)
      / nullif(sum(lots.qty_remaining) filter (where lots.qty_remaining > 0), 0),
    2
  )                                     as weighted_avg_cost,
  round(
    (i.price - coalesce(
      sum(lots.qty_remaining * lots.unit_cost) filter (where lots.qty_remaining > 0)
        / nullif(sum(lots.qty_remaining) filter (where lots.qty_remaining > 0), 0),
      0
    )) * sum(lots.qty_remaining),
    2
  )                                     as expected_profit,
  min(lots.expiry_date) filter (where lots.qty_remaining > 0) as nearest_expiry
from inventory_lots lots
join warehouses w on w.id = lots.warehouse_id
join items i on i.id = lots.item_id
group by lots.organization_id, lots.warehouse_id, w.name, lots.item_id, i.code, i.name_ar, i.price
having sum(lots.qty_remaining) <> 0;

alter view v_inventory_on_hand set (security_invoker = on);
