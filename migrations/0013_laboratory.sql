-- ============================================================================
-- 0013_laboratory.sql — موديول المختبر (Laboratory)
-- أول موديول من المجموعة الثانية التي اختارها المستخدم (المختبر، الأشعة، الصيدلية،
-- الوصفات والصرف، الباقات) قبل موديولات الإدارة (محاسبة/مشتريات/مخزون/رسائل/تدقيق)
-- ثم أخيرًا موديولات الموارد البشرية الموسّعة — بالترتيب الذي طلبه المستخدم تحديدًا.
--
-- لا يوجد أي جدول سابق لهذا الموديول في 0001-0012 — هذا تصميم مخطط جديد بالكامل،
-- وليس سد فجوة في مخطط موجود (بخلاف 0011/0012). يتبع نفس فلسفة البناء العامة:
-- كتالوج قابل للتخصيص لكل مؤسسة + دورة عمل (طلب ← سحب عيّنة ← نتيجة ← توثيق) +
-- ربط بالفوترة عبر جدول items/sales_invoices الموجودين أصلًا بدل تكرارهما.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) كتالوج الفحوصات المخبرية — لكل فحص مدى طبيعي ووحدة قياس، وربط اختياري
--    بصنف فوترة من جدول items الموجود (نفس نمط ربط dental_lab_items بالفواتير)
-- ---------------------------------------------------------------------------
create table if not exists lab_test_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade, -- null = فئة عامة نظامية
  name_ar text not null,
  name_en text,
  sort_order int not null default 0
);

create table if not exists lab_tests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  category_id uuid references lab_test_categories(id) on delete set null,
  billing_item_id uuid references items(id) on delete set null, -- الربط بكتالوج الفوترة (اختياري)
  code text,
  name_ar text not null,
  name_en text,
  specimen_type text not null default 'blood' check (specimen_type in (
    'blood','urine','stool','swab','sputum','tissue','other'
  )),
  unit text,
  normal_range_text text,           -- للمدى الوصفي (مثال: "سلبي" أو "4.0 - 11.0")
  normal_range_min numeric,         -- للمدى العددي القابل لفحص خروج القيمة عنه تلقائيًا
  normal_range_max numeric,
  turnaround_hours int,             -- الوقت التقديري لظهور النتيجة
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_lab_tests_org on lab_tests(organization_id);

-- ---------------------------------------------------------------------------
-- 2) طلبات الفحص — رأس الطلب مرتبط بالمريض والطبيب الطالب، واختياريًا بزيارة فحص
--    (patient_visits من 0006) حتى يظهر الطلب من داخل شاشة السجل الطبي مستقبلًا
-- ---------------------------------------------------------------------------
create table if not exists lab_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  ordering_doctor_id uuid references doctors(id) on delete set null,
  visit_id uuid references patient_visits(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  sales_invoice_id uuid references sales_invoices(id) on delete set null, -- يُملأ عند الفوترة
  status text not null default 'ordered' check (status in (
    'ordered','specimen_collected','in_progress','completed','verified','cancelled'
  )),
  priority text not null default 'routine' check (priority in ('routine','urgent','stat')),
  ordered_at timestamptz not null default now(),
  specimen_collected_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_lab_orders_org on lab_orders(organization_id);
create index if not exists idx_lab_orders_patient on lab_orders(patient_id);
create index if not exists idx_lab_orders_status on lab_orders(organization_id, status);

create table if not exists lab_order_items (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references lab_orders(id) on delete cascade,
  lab_test_id uuid not null references lab_tests(id) on delete restrict,
  result_value text,
  result_numeric numeric,           -- نسخة عددية من result_value لتمكين app_lab_result_is_abnormal من الفحص التلقائي
  is_abnormal boolean,              -- يُحسَب تلقائيًا عبر Trigger عند توفر normal_range_min/max
  is_critical boolean not null default false, -- يُعلَّم يدويًا من الفني لتنبيه فوري
  unit_override text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_lab_order_items_order on lab_order_items(lab_order_id);

-- ---------------------------------------------------------------------------
-- 3) مرفقات النتائج — تقرير مختبر خارجي ممسوح، أو ملف PDF من جهاز التحليل
-- ---------------------------------------------------------------------------
create table if not exists lab_result_attachments (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references lab_orders(id) on delete cascade,
  file_url text not null,
  file_name text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4) Trigger: حساب is_abnormal تلقائيًا عند إدخال/تعديل نتيجة عددية
--    (تمامًا كفلسفة bmi المحسوب تلقائيًا في 0006 — لا يُترك للواجهة حساب القيم الحرجة)
-- ---------------------------------------------------------------------------
create or replace function app_lab_result_flag_abnormal()
returns trigger
language plpgsql
as $$
declare
  range_min numeric;
  range_max numeric;
begin
  if new.result_numeric is not null then
    select normal_range_min, normal_range_max into range_min, range_max
    from lab_tests where id = new.lab_test_id;

    if range_min is not null and new.result_numeric < range_min then
      new.is_abnormal := true;
    elsif range_max is not null and new.result_numeric > range_max then
      new.is_abnormal := true;
    elsif range_min is not null or range_max is not null then
      new.is_abnormal := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lab_result_flag_abnormal on lab_order_items;
create trigger trg_lab_result_flag_abnormal
before insert or update of result_numeric on lab_order_items
for each row execute function app_lab_result_flag_abnormal();

-- ---------------------------------------------------------------------------
-- 5) Trigger: عند اكتمال كل بنود الطلب، يتحول رأس الطلب تلقائيًا إلى completed
--    (بدل الاعتماد على المستخدم لتحديث حالة الرأس يدويًا بعد كل بند)
-- ---------------------------------------------------------------------------
create or replace function app_lab_order_auto_complete()
returns trigger
language plpgsql
as $$
declare
  target_order_id uuid;
  remaining_count int;
begin
  target_order_id := coalesce(new.lab_order_id, old.lab_order_id);

  select count(*) into remaining_count
  from lab_order_items
  where lab_order_id = target_order_id
    and result_value is null
    and result_numeric is null;

  if remaining_count = 0 then
    update lab_orders
    set status = 'completed', completed_at = now()
    where id = target_order_id and status in ('ordered','specimen_collected','in_progress');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lab_order_auto_complete on lab_order_items;
create trigger trg_lab_order_auto_complete
after insert or update of result_value, result_numeric on lab_order_items
for each row execute function app_lab_order_auto_complete();

-- ---------------------------------------------------------------------------
-- 6) عرض حيّ: الطلبات المعلّقة (لم تُراجَع نتائجها) لكل مؤسسة — لشاشة تنبيهات المختبر
-- ---------------------------------------------------------------------------
create or replace view v_lab_pending_orders as
select
  o.id as lab_order_id,
  o.organization_id,
  o.patient_id,
  p.name_ar as patient_name,
  o.ordering_doctor_id,
  d.name_ar as doctor_name,
  o.status,
  o.priority,
  o.ordered_at,
  count(oi.id) as tests_count,
  count(oi.id) filter (where oi.is_abnormal) as abnormal_count,
  count(oi.id) filter (where oi.is_critical) as critical_count
from lab_orders o
join patients p on p.id = o.patient_id
left join doctors d on d.id = o.ordering_doctor_id
left join lab_order_items oi on oi.lab_order_id = o.id
where o.status <> 'verified' and o.status <> 'cancelled'
group by o.id, o.organization_id, o.patient_id, p.name_ar, o.ordering_doctor_id, d.name_ar, o.status, o.priority, o.ordered_at;

-- ---------------------------------------------------------------------------
-- 7) بيانات مرجعية: فئات فحوصات افتراضية عامة (organization_id = null) وتصنيف شائع
-- ---------------------------------------------------------------------------
insert into lab_test_categories (organization_id, name_ar, name_en, sort_order)
select null, v.name_ar, v.name_en, v.sort_order
from (values
  ('صورة الدم الكاملة', 'Hematology', 10),
  ('كيمياء الدم', 'Blood Chemistry', 20),
  ('وظائف الكبد', 'Liver Function', 30),
  ('وظائف الكلى', 'Kidney Function', 40),
  ('الغدد الصماء والهرمونات', 'Endocrinology', 50),
  ('تحليل البول', 'Urinalysis', 60),
  ('تحليل البراز', 'Stool Analysis', 70),
  ('الأمصال والمناعة', 'Serology/Immunology', 80),
  ('فحوصات الحمل والخصوبة', 'Fertility/Pregnancy', 90),
  ('فحوصات متفرقة', 'Miscellaneous', 100)
) as v(name_ar, name_en, sort_order)
where not exists (
  select 1 from lab_test_categories c where c.organization_id is null and c.name_en = v.name_en
);

-- ---------------------------------------------------------------------------
-- Row Level Security — نفس نمط كل الجداول السريرية: أعضاء المؤسسة فقط
-- ---------------------------------------------------------------------------
alter table lab_test_categories enable row level security;
alter table lab_tests enable row level security;
alter table lab_orders enable row level security;
alter table lab_order_items enable row level security;
alter table lab_result_attachments enable row level security;

create policy "lab_test_categories_read" on lab_test_categories
  for select using (organization_id is null or app_is_member(organization_id));
create policy "lab_test_categories_manage_admins" on lab_test_categories
  for insert with check (app_is_org_admin(organization_id));
create policy "lab_test_categories_update_admins" on lab_test_categories
  for update using (app_is_org_admin(organization_id));

create policy "lab_tests_all_members" on lab_tests
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "lab_orders_all_members" on lab_orders
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "lab_order_items_all_members" on lab_order_items
  for all using (
    exists (select 1 from lab_orders o where o.id = lab_order_items.lab_order_id and app_is_member(o.organization_id))
  )
  with check (
    exists (select 1 from lab_orders o where o.id = lab_order_items.lab_order_id and app_is_member(o.organization_id))
  );

create policy "lab_result_attachments_all_members" on lab_result_attachments
  for all using (
    exists (select 1 from lab_orders o where o.id = lab_result_attachments.lab_order_id and app_is_member(o.organization_id))
  )
  with check (
    exists (select 1 from lab_orders o where o.id = lab_result_attachments.lab_order_id and app_is_member(o.organization_id))
  );

-- ============================================================================
-- نهاية 0013_laboratory.sql
-- ============================================================================
