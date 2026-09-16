-- ---------------------------------------------------------------------------
-- 0166_dental_lab_module.sql — معمل الأسنان قسمًا قائمًا بذاته
-- ---------------------------------------------------------------------------
-- 0165 فتحت الشاشة القائمة. وهذه تبني ما ينقص القسم ليكون قسمًا:
--
--   • **الحالة عمودٌ واحد بلا تاريخ.** `dental_lab_orders.status` أربع قيم،
--     وتغييرها `update` مباشر من المتصفّح. فلا يُعرف **متى** أُرسلت الطلبية
--     ولا متى جُرِّبت ولا متى عادت — وهي الأسئلة الثلاثة التي يسألها الطبيب
--     كل يوم. ومن غيّر الحالة بالخطأ لا أثر له.
--
--   • **لا إعادة عمل.** التركيبة التي تعود من التجربة لتُعدَّل واقعٌ يوميّ في
--     كل عيادة أسنان، ولا تمثيل لها: فإمّا تُفتح طلبية جديدة منفصلة فينكسر
--     ربطها بالأولى، أو تُترك الأولى مفتوحة فيبدو زمن الإنجاز ضعف حقيقته.
--     **ونسبة الإعادة هي المؤشّر الأول لجودة المعمل** — من لا يقيسها يبقى مع
--     معملٍ رديء سنوات.
--
--   • **لا نوع حالة ولا مادّة.** «تاج زركونيا» و«طقم أكريليك» صنفان مختلفان
--     في السعر وزمن الإنجاز والتعامل، ويُكتبان اليوم نصًّا حرًّا في وصف
--     البند — فلا يُفرز ولا يُقارن ولا يُسعَّر.
--
--   • **لا شيء يُجمِّع.** لا لوحة تقول «ثلاث طلبيات تأخّرت»، ولا تجميع على
--     الطبيب يقول مَن له طلبيات عالقة. والطبيب يسأل الاستقبال، والاستقبال
--     يتّصل بالمعمل.
--
-- **ولا يُخترع جدول جديد للطلبيات:** `dental_lab_orders` قائم وفيه البيانات،
-- فيُوسَّع ولا يُستبدَل — واستبداله يترك تاريخ المنشأة في جدولٍ لا يقرؤه أحد.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الاسم: «معمل الأسنان» لا «معامل الأسنان»
-- ═══════════════════════════════════════════════════════════════════════════
update feature_catalog
   set name_ar = 'معمل الأسنان'
 where feature_key = 'dental_lab' and name_ar is distinct from 'معمل الأسنان';

update permission_catalog
   set name_ar = case permission_key
                   when 'dental_lab.view'   then 'عرض معمل الأسنان'
                   when 'dental_lab.manage' then 'إدارة معمل الأسنان'
                   else name_ar end
 where module_key = 'dental_lab';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) اللوائح: نوع الحالة والمادّة
--
-- عالمية (`organization_id = null`) لأنّها تسميات المهنة لا تسميات منشأة،
-- والمنشأة تُعطّل ما لا تستعمله من شاشة اللوائح — لا تُحذف.
-- ═══════════════════════════════════════════════════════════════════════════
insert into lookup_categories (organization_id, key, name_ar, name_en)
select null, v.k, v.ar, v.en
from (values
  ('dental_lab_case_types', 'أنواع حالات معمل الأسنان', 'Dental Lab Case Types'),
  ('dental_lab_materials',  'مواد معمل الأسنان',        'Dental Lab Materials')
) as v(k, ar, en)
where not exists (
  select 1 from lookup_categories c where c.key = v.k and c.organization_id is null
);

insert into lookup_values (category_id, code, name_ar, name_en, sort_order)
select c.id, v.code, v.ar, v.en, v.o
from lookup_categories c
cross join (values
  ('CROWN',    'تاج',                  'Crown',                 1),
  ('BRIDGE',   'جسر',                  'Bridge',                2),
  ('VENEER',   'فينير',                'Veneer',                3),
  ('INLAY',    'حشوة مصبوبة (إنلي/أونلي)', 'Inlay / Onlay',     4),
  ('POST',     'وتد ولبّ',             'Post & Core',           5),
  ('IMPL_ABUT','دعامة زرعة',           'Implant Abutment',      6),
  ('FULL_DENT','طقم كامل',             'Complete Denture',      7),
  ('PART_DENT','طقم جزئي',             'Partial Denture',       8),
  ('ORTHO',    'جهاز تقويم',           'Orthodontic Appliance', 9),
  ('RETAINER', 'مثبِّت تقويم',          'Retainer',             10),
  ('NIGHTGRD', 'حارس ليلي',            'Night Guard',          11),
  ('REPAIR',   'إصلاح وتعديل',         'Repair / Adjustment',  12)
) as v(code, ar, en, o)
where c.key = 'dental_lab_case_types' and c.organization_id is null
  and not exists (
    select 1 from lookup_values x where x.category_id = c.id and x.code = v.code
  );

insert into lookup_values (category_id, code, name_ar, name_en, sort_order)
select c.id, v.code, v.ar, v.en, v.o
from lookup_categories c
cross join (values
  ('ZIRCONIA', 'زركونيا',                  'Zirconia',                1),
  ('EMAX',     'إيماكس (ديسيليكات ليثيوم)', 'Lithium Disilicate',      2),
  ('PFM',      'بورسلين على معدن',          'Porcelain-Fused-to-Metal',3),
  ('FULLCAST', 'معدن مصبوب كامل',           'Full Cast Metal',         4),
  ('COCR',     'كروم كوبالت',              'Cobalt-Chrome',           5),
  ('ACRYLIC',  'أكريليك',                  'Acrylic',                 6),
  ('FLEXIBLE', 'طقم مرن',                  'Flexible',                7),
  ('COMPOSITE','كومبوزيت',                 'Composite',               8),
  ('WAX',      'شمع تجربة',                'Wax Try-in',              9)
) as v(code, ar, en, o)
where c.key = 'dental_lab_materials' and c.organization_id is null
  and not exists (
    select 1 from lookup_values x where x.category_id = c.id and x.code = v.code
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) أعمدة الطلبية الناقصة
--
-- `sent_at` و`try_in_date` غير `order_date`: الطلبية تُسجَّل اليوم وتُرسَل
-- غدًا حين تجهز الطبعة. وقياس زمن الإنجاز من التسجيل يُحمّل المعمل تأخيرًا
-- ليس منه.
-- ═══════════════════════════════════════════════════════════════════════════
alter table dental_lab_orders
  add column if not exists case_type_value_id uuid references lookup_values(id),
  add column if not exists material_value_id  uuid references lookup_values(id),
  add column if not exists sent_at            date,
  add column if not exists try_in_date        date,
  add column if not exists priority           text not null default 'normal',
  add column if not exists rework_of_order_id uuid references dental_lab_orders(id),
  add column if not exists rework_reason      text,
  add column if not exists updated_by         uuid references auth.users(id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dental_lab_orders_priority_check') then
    alter table dental_lab_orders
      add constraint dental_lab_orders_priority_check
      check (priority in ('normal','urgent'));
  end if;
  -- طلبية إعادةٍ بلا سبب لا تُقاس: نسبة الإعادة تقول «كم»، والسبب يقول «لماذا»
  if not exists (select 1 from pg_constraint where conname = 'dental_lab_orders_rework_reason_check') then
    alter table dental_lab_orders
      add constraint dental_lab_orders_rework_reason_check
      check (rework_of_order_id is null
             or coalesce(btrim(rework_reason), '') <> '');
  end if;
end $$;

create index if not exists idx_dental_lab_orders_doctor
  on dental_lab_orders (organization_id, doctor_id, status);
create index if not exists idx_dental_lab_orders_due
  on dental_lab_orders (organization_id, delivery_date)
  where status in ('pending','in_progress');
create index if not exists idx_dental_lab_orders_rework
  on dental_lab_orders (rework_of_order_id)
  where rework_of_order_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) سجلّ أحداث الحالة — «متى» لا «ما هي»
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists dental_lab_order_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  order_id         uuid not null references dental_lab_orders(id) on delete cascade,
  event_type       text not null
                     check (event_type in ('created','sent','try_in','rework',
                                           'received','delivered','cancelled','note')),
  occurred_at      timestamptz not null default now(),
  note             text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

create index if not exists idx_dental_lab_events_order
  on dental_lab_order_events (order_id, occurred_at);

alter table dental_lab_order_events enable row level security;
drop policy if exists dental_lab_events_read on dental_lab_order_events;
create policy dental_lab_events_read on dental_lab_order_events
  for select using (app_is_member(organization_id));
drop policy if exists dental_lab_events_write on dental_lab_order_events;
create policy dental_lab_events_write on dental_lab_order_events
  for all
  using (app_is_member(organization_id)
         and app_has_permission(organization_id, 'dental_lab.manage'))
  with check (app_is_member(organization_id)
         and app_has_permission(organization_id, 'dental_lab.manage'));
revoke all on dental_lab_order_events from anon;
grant select, insert on dental_lab_order_events to authenticated;

comment on table dental_lab_order_events is
  'سجلّ أحداث طلبية المعمل: متى أُرسلت وجُرِّبت وعادت واستُلمت وسُلِّمت. الحالة تقول «أين هي»، وهذا يقول «متى صارت كذلك ومَن نقلها».';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) نقل الحالة — دالّة ذرّية تكتب الحالة وطابعها وحدثها معًا
--
-- كان النقل `update` من المتصفّح: يكتب `status` وحده، فتبقى الطلبية «قيد
-- التنفيذ» بلا `sent_at`، ويبقى «تم التسليم» بلا `received_date` إن نسيه
-- المتصفّح. والثلاثة حقيقةٌ واحدة تُكتب معًا أو لا تُكتب.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_dental_lab_transition(
  p_order_id uuid,
  p_action   text,   -- send | try_in | rework | receive | deliver | cancel | reopen
  p_note     text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o          dental_lab_orders%rowtype;
  v_next     text;
  v_event    text;
  v_affected integer;
begin
  select * into o from dental_lab_orders where id = p_order_id;
  if not found then
    raise exception 'الطلبية غير موجودة';
  end if;
  if not app_is_member(o.organization_id) then
    raise exception 'لا تملك الوصول إلى هذه الطلبية';
  end if;
  if not app_has_permission(o.organization_id, 'dental_lab.manage') then
    raise exception 'لا تملك صلاحية إدارة معمل الأسنان';
  end if;
  if o.status = 'cancelled' then
    raise exception 'الطلبية ملغاة — الرجوع عنها قرارٌ ماليّ يُعالَج بالسندات أوّلًا';
  end if;

  if p_action = 'send' then
    if o.status <> 'pending' then
      raise exception 'لا تُرسَل إلّا طلبيةٌ قيد الانتظار';
    end if;
    update dental_lab_orders
       set status = 'in_progress',
           sent_at = coalesce(sent_at, current_date),
           updated_at = now(), updated_by = auth.uid()
     where id = o.id;
    v_next := 'in_progress'; v_event := 'sent';

  elsif p_action = 'try_in' then
    if o.status <> 'in_progress' then
      raise exception 'التجربة لا تكون إلّا لطلبيةٍ قيد التنفيذ';
    end if;
    update dental_lab_orders
       set try_in_date = current_date, updated_at = now(), updated_by = auth.uid()
     where id = o.id;
    v_next := o.status; v_event := 'try_in';

  elsif p_action = 'rework' then
    -- الإعادة **لا تُغيّر الحالة**: الطلبية ما زالت عند المعمل. تُسجَّل حدثًا
    -- بسببه، ونسبةُ الإعادة تُحسب من الأحداث لا من حقلٍ يُكتب فوقه.
    if o.status <> 'in_progress' then
      raise exception 'الإعادة لا تكون إلّا لطلبيةٍ قيد التنفيذ';
    end if;
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'سبب الإعادة مطلوب';
    end if;
    v_next := o.status; v_event := 'rework';

  elsif p_action = 'receive' then
    if o.status <> 'in_progress' then
      raise exception 'الاستلام لا يكون إلّا لطلبيةٍ قيد التنفيذ';
    end if;
    update dental_lab_orders
       set received_date = coalesce(received_date, current_date),
           updated_at = now(), updated_by = auth.uid()
     where id = o.id;
    v_next := o.status; v_event := 'received';

  elsif p_action = 'deliver' then
    if o.status not in ('pending','in_progress') then
      raise exception 'التسليم لا يكون إلّا لطلبيةٍ مفتوحة';
    end if;
    update dental_lab_orders
       set status = 'delivered',
           received_date = coalesce(received_date, current_date),
           updated_at = now(), updated_by = auth.uid()
     where id = o.id;
    v_next := 'delivered'; v_event := 'delivered';

  elsif p_action = 'reopen' then
    if o.status <> 'delivered' then
      raise exception 'لا يُعاد فتح إلّا ما سُلِّم';
    end if;
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'سبب إعادة الفتح مطلوب';
    end if;
    update dental_lab_orders
       set status = 'in_progress', updated_at = now(), updated_by = auth.uid()
     where id = o.id;
    v_next := 'in_progress'; v_event := 'note';

  elsif p_action = 'cancel' then
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'سبب الإلغاء مطلوب';
    end if;
    -- المالك يمنع إلغاء مستندٍ صُرف عليه: السندات تُعالَج أوّلًا
    if coalesce(o.paid_amount, 0) > 0 then
      raise exception 'على الطلبية مبالغ مصروفة — عالِج سنداتها قبل الإلغاء';
    end if;
    update dental_lab_orders
       set status = 'cancelled', updated_at = now(), updated_by = auth.uid()
     where id = o.id;
    v_next := 'cancelled'; v_event := 'cancelled';

  else
    raise exception 'إجراء غير معروف: %', p_action;
  end if;

  get diagnostics v_affected = row_count;

  insert into dental_lab_order_events (organization_id, order_id, event_type, note, created_by)
  values (o.organization_id, o.id, v_event, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return v_next;
end;
$$;

comment on function app_dental_lab_transition(uuid, text, text) is
  'نقل حالة طلبية معمل الأسنان: يكتب الحالة وطابعها الزمنيّ وحدثها في معاملة واحدة، ويفرض ما يصحّ من أين.';

revoke all on function app_dental_lab_transition(uuid, text, text) from public, anon;
grant execute on function app_dental_lab_transition(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) منظور الطلبيات — صفٌّ واحد يغني عن ستّ قراءات
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_dental_lab_orders as
select
  o.id,
  o.organization_id,
  o.order_number,
  o.order_date,
  o.sent_at,
  o.try_in_date,
  o.delivery_date,
  o.received_date,
  o.status,
  o.priority,
  o.note,
  o.lab_invoice_number,

  o.distributor_id,
  d.name_ar                       as lab_name,
  d.lab_technician_name,
  d.lab_technician_mobile,
  d.payment_terms_days,

  o.patient_id,
  p.name_ar                       as patient_name,
  p.file_number                   as patient_file_number,
  p.mobile_number                 as patient_mobile,

  o.doctor_id,
  doc.name_ar                     as doctor_name,

  ct.name_ar                      as case_type_name,
  mt.name_ar                      as material_name,
  sh.code                         as shade_code,

  o.total_amount,
  o.paid_amount,
  coalesce(o.remaining_amount, 0) as remaining_amount,

  li.items_count,
  li.works,
  li.teeth,

  o.rework_of_order_id,
  o.rework_reason,
  ev.rework_count,
  ev.last_event_type,
  ev.last_event_at,

  -- الأيام عند المعمل: من الإرسال لا من التسجيل. الطلبية تُسجَّل اليوم
  -- وتُرسَل غدًا حين تجهز الطبعة، وتحميلُ المعمل ذلك اليوم ظلم.
  case
    when o.sent_at is null then null
    else (coalesce(o.received_date, current_date) - o.sent_at)
  end                             as days_at_lab,

  -- متأخّرة: موعد التسليم مضى ولم تُستلم ولم تُسلَّم
  (o.status in ('pending','in_progress')
     and o.delivery_date is not null
     and o.delivery_date < current_date)                    as is_overdue,
  (o.status in ('pending','in_progress')
     and o.delivery_date = current_date)                    as is_due_today,

  o.created_by,
  o.created_at,
  o.updated_at
from dental_lab_orders o
left join distributors d  on d.id = o.distributor_id
left join patients p      on p.id = o.patient_id
left join doctors doc     on doc.id = o.doctor_id
left join lookup_values ct on ct.id = o.case_type_value_id
left join lookup_values mt on mt.id = o.material_value_id
left join tooth_shades sh  on sh.id = o.shade_id
left join lateral (
  select
    count(*)                                              as items_count,
    string_agg(coalesce(nullif(btrim(i.description), ''), '—'), '، ' order by i.created_at) as works,
    -- أرقام الأسنان مجموعةً من كل البنود: الطبيب يسأل «أيّ سنّ؟» لا «كم بندًا؟»
    (select string_agg(distinct t, '، ')
       from dental_lab_order_items i2, unnest(coalesce(i2.tooth_numbers, '{}')) as t
      where i2.order_id = o.id)                            as teeth
  from dental_lab_order_items i
  where i.order_id = o.id
) li on true
left join lateral (
  select
    count(*) filter (where e.event_type = 'rework')        as rework_count,
    (array_agg(e.event_type order by e.occurred_at desc))[1] as last_event_type,
    max(e.occurred_at)                                    as last_event_at
  from dental_lab_order_events e
  where e.order_id = o.id
) ev on true;

alter view v_dental_lab_orders set (security_invoker = on);
revoke all on v_dental_lab_orders from anon;
grant select on v_dental_lab_orders to authenticated;

comment on view v_dental_lab_orders is
  'طلبيات معمل الأسنان مجمَّعةً: المعمل وفنّيه، والمريض وملفّه، والطبيب، ونوع الحالة والمادّة واللون، والبنود والأسنان، وأيام المكوث عند المعمل، والتأخّر، وعدد الإعادات.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) التجميع على الطبيب — «مَن له طلبيات عالقة»
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_dental_lab_by_doctor as
select
  o.organization_id,
  o.doctor_id,
  o.doctor_name,
  count(*) filter (where o.status in ('pending','in_progress'))  as open_count,
  count(*) filter (where o.is_overdue)                           as overdue_count,
  count(*) filter (where o.is_due_today)                         as due_today_count,
  count(*) filter (where o.status = 'delivered')                 as delivered_count,
  coalesce(sum(o.rework_count), 0)                               as rework_events,
  count(*)                                                       as total_count,
  coalesce(sum(o.total_amount) filter (where o.status <> 'cancelled'), 0) as total_amount,
  coalesce(sum(o.remaining_amount) filter (where o.status <> 'cancelled'), 0) as remaining_amount,
  round(avg(o.days_at_lab) filter (where o.days_at_lab is not null), 1)      as avg_days_at_lab,
  max(o.order_date)                                              as last_order_date
from v_dental_lab_orders o
where o.doctor_id is not null
group by o.organization_id, o.doctor_id, o.doctor_name;

alter view v_dental_lab_by_doctor set (security_invoker = on);
revoke all on v_dental_lab_by_doctor from anon;
grant select on v_dental_lab_by_doctor to authenticated;

comment on view v_dental_lab_by_doctor is
  'طلبيات معمل الأسنان مجمَّعةً على الطبيب: المفتوح والمتأخّر والمستحقّ اليوم، وعدد الإعادات، ومتوسّط أيام المكوث. الطبيب بلا طلبيات لا يظهر.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) التجميع على المعمل — أداء المورّد لا المشتري
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_dental_lab_by_lab as
select
  o.organization_id,
  o.distributor_id,
  o.lab_name,
  count(*) filter (where o.status in ('pending','in_progress'))  as open_count,
  count(*) filter (where o.is_overdue)                           as overdue_count,
  count(*) filter (where o.status = 'delivered')                 as delivered_count,
  count(*)                                                       as total_count,
  coalesce(sum(o.rework_count), 0)                               as rework_events,
  -- **نسبة الإعادة هي المؤشّر الأوّل لجودة المعمل.** تُحسب على المُسلَّم لا
  -- على الكلّ: طلبيةٌ ما زالت عند المعمل لم يُحكَم عليها بعد.
  case when count(*) filter (where o.status = 'delivered') = 0 then 0
       else round(coalesce(sum(o.rework_count), 0) * 100.0
                  / count(*) filter (where o.status = 'delivered'), 1) end   as rework_percent,
  round(avg(o.days_at_lab) filter (where o.days_at_lab is not null), 1)      as avg_days_at_lab,
  coalesce(sum(o.total_amount) filter (where o.status <> 'cancelled'), 0)    as total_amount,
  coalesce(sum(o.remaining_amount) filter (where o.status <> 'cancelled'), 0) as remaining_amount
from v_dental_lab_orders o
where o.distributor_id is not null
group by o.organization_id, o.distributor_id, o.lab_name;

alter view v_dental_lab_by_lab set (security_invoker = on);
revoke all on v_dental_lab_by_lab from anon;
grant select on v_dental_lab_by_lab to authenticated;

comment on view v_dental_lab_by_lab is
  'أداء كل معمل: المفتوح والمتأخّر والمسلَّم، ونسبة الإعادة على المُسلَّم، ومتوسّط أيام الإنجاز، والمبالغ والمتبقّي.';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0166_dental_lab_module.sql
-- ---------------------------------------------------------------------------
