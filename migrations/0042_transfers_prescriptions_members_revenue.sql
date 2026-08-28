-- 0042: أعمدة وعروض ناقصة اكتُشفت في التدقيق الثاني للقطات الـ133
--
-- يجمع هذا الملف خمس نواقص صغيرة مستقلة بدل خمسة ملفات، لأن كلًّا منها
-- إضافة عمود/عرض بلا منطق مشترك، وتنفيذها دفعة واحدة يقلّل احتمال تنفيذ
-- بعضها دون بعض على قاعدة إنتاج.
--
-- كل التعديلات هنا إضافية (additive) فقط: لا حذف عمود ولا تغيير نوع، فلا
-- يتأثر أي كود قائم.

-- ---------------------------------------------------------------------------
-- 1) رقم متسلسل للمناقلات (لقطة 46)
--    المواصفة تعرض "رقم الطلب" في قائمة المناقلات. `stock_transfers` كان
--    يُعرَّف بـ uuid فقط — والـ uuid لا يصلح رقمًا يقرأه موظف المستودع أو
--    يذكره في مكالمة. النمط نفسه المستخدَم في sales_invoices.invoice_number.
-- ---------------------------------------------------------------------------
alter table stock_transfers add column if not exists transfer_number bigserial;

-- ---------------------------------------------------------------------------
-- 2) حقول التأمين وحالة الفوترة في الوصفة (لقطة 39)
--    شاشة الوصفات في المواصفة تعرض شركة التأمين ورقم البوليصة وعلامة
--    "تمت الفوترة". لم تكن أيٌّ منها موجودة في `prescriptions` — والاعتماد
--    على نسخها وقت العرض من فاتورة المريض الحالية خاطئ، لأن بيانات التأمين
--    وقت صرف الوصفة قد تختلف عن بياناته اليوم.
-- ---------------------------------------------------------------------------
alter table prescriptions add column if not exists insurance_company_name text;
alter table prescriptions add column if not exists insurance_policy_number text;
alter table prescriptions add column if not exists is_billed boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3) بيانات العضوية المعروضة في شاشة المستخدمين (لقطة 78)
--    لغة العرض والجوال والملاحظة خصائص عضوية في المؤسسة لا خصائص حساب،
--    فمكانها `organization_memberships` لا `auth.users` (الذي لا يملك
--    العميل صلاحية الكتابة فيه أصلًا).
-- ---------------------------------------------------------------------------
alter table organization_memberships
  add column if not exists display_language text not null default 'ar'
  check (display_language in ('ar', 'en'));
alter table organization_memberships add column if not exists mobile_number text;
alter table organization_memberships add column if not exists note text;

-- ---------------------------------------------------------------------------
-- 4) عرض: إيراد المركز مجمَّعًا حسب المستخدم (لقطة 30)
--    `v_daily_revenue` يجمّع على مستوى المؤسسة واليوم فقط. التجميع حسب
--    المستخدم يُضاف كعرض منفصل لا كتعديل للأصلي — لنفس سبب 0041: إضافة
--    بُعد للتجميع تضاعف الصفوف وتضخّم أي مجموع في الشاشات القائمة.
--    الاسم يأتي من `v_organization_members_directory` (0026) لا من
--    auth.users، لأن العميل لا يقرأ auth.users.
-- ---------------------------------------------------------------------------
create or replace view v_daily_revenue_by_user as
select
  si.organization_id,
  si.created_at::date          as revenue_date,
  si.created_by                as user_id,
  coalesce(dir.display_name, 'غير محدَّد') as user_name,
  count(*)                     as invoice_count,
  sum(si.subtotal_amount)      as gross_amount,
  sum(si.discount_amount)      as discount_amount,
  sum(si.vat_amount)           as vat_amount,
  sum(si.net_amount)           as net_amount,
  sum(si.paid_amount)          as paid_amount
from sales_invoices si
left join v_organization_members_directory dir
  on dir.user_id = si.created_by
 and dir.organization_id = si.organization_id
where si.invoice_type = 'sale'
  and si.status <> 'void'
  and si.is_temporary = false
group by si.organization_id, si.created_at::date, si.created_by, dir.display_name;

-- ---------------------------------------------------------------------------
-- 5) مجموعات الفوترة السريعة (لقطة 22)
--    أزرار جاهزة تضيف مجموعة أصناف دفعةً واحدة إلى الفاتورة. لا يمكن
--    تمثيلها بالعروض (offers) لأن العرض كيان تسعيري له نسبة خصم ومدة
--    صلاحية، بينما هذه مجرد اختصار إدخال بلا أثر مالي.
-- ---------------------------------------------------------------------------
create table if not exists quick_invoice_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name_ar text not null,
  color text,
  sort_order int not null default 0,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_quick_invoice_groups_org on quick_invoice_groups (organization_id);

create table if not exists quick_invoice_group_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references quick_invoice_groups(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  qty numeric(12,2) not null default 1,
  sort_order int not null default 0,
  -- صنف مكرر داخل المجموعة يعني سطرين متطابقين في الفاتورة بلا سبب —
  -- الكمية هي الطريقة الصحيحة للتعبير عن "أكثر من واحد".
  unique (group_id, item_id)
);
create index if not exists idx_quick_invoice_group_items_group on quick_invoice_group_items (group_id);

alter table quick_invoice_groups enable row level security;
alter table quick_invoice_group_items enable row level security;

drop policy if exists "quick_invoice_groups_all" on quick_invoice_groups;
create policy "quick_invoice_groups_all" on quick_invoice_groups
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- عناصر المجموعة لا تحمل organization_id — الانتماء يُستنتج من المجموعة
-- الأم، فلا يمكن تسريب عنصر لمؤسسة أخرى ولا تكرار العمود بلا داعٍ.
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
      select 1 from quick_invoice_groups g
      where g.id = quick_invoice_group_items.group_id
        and app_is_member(g.organization_id)
    )
  );
