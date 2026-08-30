-- ---------------------------------------------------------------------------
-- 0071_service_catalog_core.sql — المرحلة 1: بيانات الخدمة والتعديل والأرشفة
-- ---------------------------------------------------------------------------
-- `items` اليوم كتالوج **أصناف** لا كتالوج **خدمات طبية**: اسم عربي وسعر
-- وتكلفة وضريبة. وهذا يكفي لبيع منتج، ولا يكفي لخدمة سريرية:
--
--   • **لا اسم إنجليزي ولا وصف.** المطالبات وبطاقات التأمين تُكتب
--     بالإنجليزية، والوصف هو ما يشرح للمريض ما سيُجرى له.
--   • **لا نوع طبي.** «خدمة» تشمل الكشف والعملية والتطعيم والجلسة — ولا
--     يمكن بناء تقرير ولا قاعدة تسعير على تصنيف واحد بهذا الاتساع.
--   • **لا قسم ولا عيادة ولا فروع.** فتظهر خدمة أسنان في عيادة عيون، وخدمة
--     فرعٍ في فرعٍ لا يقدّمها.
--   • **لا مدّة تنفيذ.** فلا يستطيع التقويم أن يقترح طول الموعد من الخدمة
--     المطلوبة، ويُحجز للجميع ثلاثون دقيقة.
--   • **لا أرشفة.** الصنف إمّا مفعَّل أو «معطَّل»، والتعطيل يُخفيه من الاختيار
--     ويُبقيه في كل قائمة وتقرير. أما الحذف فمستحيل: القيود الأجنبية من
--     الفواتير تمنعه — وهذا صواب، فحذفه يمحو سند بند في فاتورة صادرة.
--
-- هذه المرحلة تُضيف البيانات والأرشفة والربط. **ولا تلمس المختبر والأشعة**:
-- كتالوجاهما يبقيان متخصّصَين ومربوطَين بالصنف المالي عبر
-- `billing_item_id` (0057). الدمج الكامل كان سيُدخل حقول العيّنة والمدى
-- الطبيعي والجهاز في جدول الأصناف، ويكسر مسار الطلبات القائم — كلفة عالية
-- بلا مقابل اليوم.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) حقول الخدمة
-- ---------------------------------------------------------------------------
alter table items
  add column if not exists description_ar        text,
  add column if not exists description_en        text,
  add column if not exists medical_service_type  text,
  add column if not exists default_clinic_id     uuid references clinics(id) on delete set null,
  add column if not exists duration_minutes      integer,
  add column if not exists provider_role         text,
  add column if not exists requires_appointment  boolean not null default false,
  add column if not exists revenue_account_id    uuid references chart_of_accounts(id) on delete set null,
  add column if not exists cogs_account_id       uuid references chart_of_accounts(id) on delete set null,
  add column if not exists is_archived           boolean not null default false,
  add column if not exists archived_at           timestamptz,
  add column if not exists archived_by           uuid references auth.users(id),
  add column if not exists archive_reason        text;

-- النوع الطبي: قائمة مغلقة لا جدول بحث.
--
-- التقارير وقواعد التسعير تُبنى على هذه القيم، وجدول بحث مفتوح يجعل كل منشأة
-- تخترع تسميتها فيصير التقرير غير قابل للمقارنة. و«أخرى» موجودة لما لا
-- ينطبق، فلا يُجبَر أحد على تصنيف خاطئ.
alter table items drop constraint if exists items_medical_service_type_check;
alter table items add constraint items_medical_service_type_check check (
  medical_service_type is null or medical_service_type in (
    'consultation','follow_up','procedure','surgery','dental','physiotherapy',
    'vaccination','lab','radiology','nursing','home_visit','package','product','other'
  )
);

alter table items drop constraint if exists items_provider_role_check;
alter table items add constraint items_provider_role_check check (
  provider_role is null or provider_role in ('doctor','nurse','technician','pharmacist','any')
);

alter table items drop constraint if exists items_duration_check;
alter table items add constraint items_duration_check check (
  duration_minutes is null or duration_minutes between 1 and 1440
);

create index if not exists idx_items_service_type
  on items (organization_id, medical_service_type) where medical_service_type is not null;
create index if not exists idx_items_active
  on items (organization_id, item_type) where not is_archived and not is_disabled;

-- ---------------------------------------------------------------------------
-- 2) الفروع المتاحة
--
-- **الغياب يعني «كل الفروع»**، لا «لا فرع». سطر لكل صنف في كل فرع كان
-- سيتطلّب تعبئة آلاف الصفوف قبل أن يعمل شيء، ويجعل كل صنف جديد غير متاح حتى
-- يتذكّر أحدهم إضافته. القيد يُضاف حين يُراد التقييد فقط.
-- ---------------------------------------------------------------------------
create table if not exists item_branches (
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  branch_id       uuid not null references branches(id) on delete cascade,
  primary key (item_id, branch_id)
);

create index if not exists idx_item_branches_branch on item_branches (branch_id);

alter table item_branches enable row level security;
drop policy if exists "item_branches_read" on item_branches;
create policy "item_branches_read" on item_branches
  for select using (app_is_member(organization_id));
drop policy if exists "item_branches_write" on item_branches;
create policy "item_branches_write" on item_branches
  for all using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
revoke all on item_branches from anon;
grant select, insert, update, delete on item_branches to authenticated;

create or replace function app_item_available_in_branch(p_item_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_branch_id is null
      or not exists (select 1 from item_branches b where b.item_id = p_item_id)
      or exists (select 1 from item_branches b
                  where b.item_id = p_item_id and b.branch_id = p_branch_id);
$$;

revoke all on function app_item_available_in_branch(uuid, uuid) from public, anon;
grant execute on function app_item_available_in_branch(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) صلاحيات الكتالوج
-- ---------------------------------------------------------------------------
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order) values
  ('catalog.view',    'عرض الكتالوج',      'catalog', 'رؤية الخدمات والأصناف',                190),
  ('catalog.manage',  'إدارة الكتالوج',    'catalog', 'إنشاء الخدمات وتعديلها وأرشفتها',      200),
  ('catalog.pricing', 'إدارة قوائم الأسعار','catalog', 'الأسعار حسب الفرع والدفع والتأمين',   210)
on conflict (permission_key) do update
  set name_ar = excluded.name_ar, module_key = excluded.module_key,
      description_ar = excluded.description_ar, display_order = excluded.display_order;

insert into role_default_permissions (role_key, permission_key) values
  ('receptionist',   'catalog.view'),
  ('doctor',         'catalog.view'),
  ('nurse',          'catalog.view'),
  ('pharmacist',     'catalog.view'),
  ('lab_technician', 'catalog.view'),
  ('radiology_technician', 'catalog.view'),
  -- التسعير قرار مالي: المحاسب ومدير الفرع، لا الاستقبال.
  ('accountant',     'catalog.view'),
  ('accountant',     'catalog.pricing'),
  ('branch_manager', 'catalog.view'),
  ('branch_manager', 'catalog.manage'),
  ('branch_manager', 'catalog.pricing')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4) الأرشفة — لا الحذف
--
-- الفرق عن `is_disabled` مقصود ومحفوظ:
--   • **معطَّل** = متوقّف مؤقتًا. يختفي من الاختيار ويبقى في القوائم
--     والتقارير، ويُعاد تفعيله بضغطة.
--   • **مؤرشَف** = خرج من الخدمة. يختفي من كل شيء افتراضيًا، ويحتاج سببًا،
--     ويُسجَّل من أرشفه ومتى.
--
-- ولا حذف إطلاقًا: القيود الأجنبية من `sales_invoice_items` تمنعه، وهذا
-- صواب — حذف الصنف يمحو سند بند في فاتورة صادرة.
-- ---------------------------------------------------------------------------
create or replace function app_archive_item(p_item_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item items%rowtype;
  v_open integer;
begin
  select * into v_item from items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'الصنف غير موجود';
  end if;
  if not app_has_permission(v_item.organization_id, 'catalog.manage') then
    raise exception 'صلاحيتك لا تسمح بأرشفة الأصناف';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب الأرشفة مطلوب';
  end if;
  if v_item.is_archived then
    raise exception 'الصنف مؤرشَف أصلًا';
  end if;

  -- خدمة سُجّلت في زيارة ولم تُفوتَر بعد: أرشفتها الآن تُخفيها عن المحاسب
  -- فتضيع من الفاتورة. تُفوتَر أولًا ثم تُؤرشَف.
  select count(*) into v_open
    from patient_visit_services s
   where s.item_id = p_item_id
     and not exists (select 1 from sales_invoice_items li where li.visit_service_id = s.id);
  if v_open > 0 then
    raise exception 'لا يمكن الأرشفة: % خدمة منفَّذة لم تُفوتَر بعد تستعمل هذا الصنف', v_open;
  end if;

  update items
     set is_archived = true,
         archived_at = now(),
         archived_by = auth.uid(),
         archive_reason = btrim(p_reason),
         is_disabled = true,
         updated_at = now()
   where id = p_item_id;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, reason)
  values (v_item.organization_id, auth.uid(), 'update', 'items', p_item_id,
          coalesce(v_item.name_ar, 'صنف'), 'أرشفة', btrim(p_reason));
end;
$$;

create or replace function app_restore_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_item items%rowtype;
begin
  select * into v_item from items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'الصنف غير موجود';
  end if;
  if not app_has_permission(v_item.organization_id, 'catalog.manage') then
    raise exception 'صلاحيتك لا تسمح بذلك';
  end if;
  if not v_item.is_archived then
    raise exception 'الصنف غير مؤرشَف';
  end if;

  -- يُستعاد **معطَّلًا**: عودته إلى قوائم الاختيار مباشرةً قد تُفاجئ من لا
  -- يعلم بالاستعادة. تفعيله خطوة ثانية واعية.
  update items
     set is_archived = false, archived_at = null, archived_by = null,
         archive_reason = null, is_disabled = true, updated_at = now()
   where id = p_item_id;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details)
  values (v_item.organization_id, auth.uid(), 'update', 'items', p_item_id,
          coalesce(v_item.name_ar, 'صنف'), 'استعادة من الأرشيف');
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array['app_archive_item(uuid,text)', 'app_restore_item(uuid)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5) منظور الكتالوج
--
-- **المؤرشَف مستثنى هنا**، وشاشة الكتالوج تقرأ الجدول مباشرةً حين يطلب
-- المستخدم رؤية الأرشيف صراحةً. بهذا لا يظهر المؤرشَف في أي مكان بالخطأ.
-- ---------------------------------------------------------------------------
create or replace view v_service_catalog as
select
  i.id,
  i.organization_id,
  i.code,
  i.barcode,
  i.name_ar,
  i.name_en,
  i.description_ar,
  i.description_en,
  i.item_type,
  i.medical_service_type,
  i.category_value_id,
  cat.name_ar                       as category_name,
  i.default_clinic_id,
  c.name                            as clinic_name,
  i.duration_minutes,
  i.provider_role,
  i.requires_appointment,
  i.price,
  i.cost_price,
  i.is_vat_exempt,
  i.vat_rate_override,
  i.default_discount_percent,
  i.is_disabled,
  i.revenue_account_id,
  i.cogs_account_id,
  -- الفروع المتاحة: مصفوفة فارغة تعني «كل الفروع»
  coalesce((select array_agg(b.branch_id) from item_branches b where b.item_id = i.id), '{}') as branch_ids,
  i.created_at,
  i.updated_at
from items i
left join lookup_values cat on cat.id = i.category_value_id
left join clinics c on c.id = i.default_clinic_id
where not i.is_archived;

alter view v_service_catalog set (security_invoker = on);
revoke all on v_service_catalog from anon;
grant select on v_service_catalog to authenticated;

commit;
