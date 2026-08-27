-- ============================================================================
-- 0014_radiology.sql — موديول الأشعة والتصوير الطبي (Radiology)
-- ثاني موديول من المجموعة الطبية الجديدة (بعد المختبر 0013). يتبع نفس فلسفة
-- البناء: كتالوج قابل للتخصيص + دورة عمل (طلب ← جدولة ← تنفيذ ← تقرير) + ربط
-- اختياري بالفوترة عبر items الموجود. الفرق الجوهري عن المختبر: لا توجد "نتيجة
-- عددية" بل تقرير نصي (الموجودات/الانطباع) وصور مرفقة، والتقرير خطوة مهنية
-- مستقلة عن "الإنجاز" — فني الأشعة يُنجز التصوير، ثم الطبيب/الأخصائي يكتب
-- التقرير ويوثّقه، تمامًا كما في سير العمل الفعلي.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) كتالوج فحوصات الأشعة — مجموعة حسب نوع الجهاز (Modality)
-- ---------------------------------------------------------------------------
create table if not exists radiology_exam_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade, -- null = فئة عامة نظامية
  name_ar text not null,
  name_en text,
  sort_order int not null default 0
);

create table if not exists radiology_exams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  category_id uuid references radiology_exam_categories(id) on delete set null,
  billing_item_id uuid references items(id) on delete set null,
  code text,
  name_ar text not null,
  name_en text,
  modality text not null default 'xray' check (modality in (
    'xray','ct','mri','ultrasound','mammography','fluoroscopy','other'
  )),
  body_part text,
  requires_contrast boolean not null default false,
  preparation_instructions text,    -- مثال: "الصيام 6 ساعات قبل الفحص"
  estimated_duration_minutes int,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_radiology_exams_org on radiology_exams(organization_id);

-- ---------------------------------------------------------------------------
-- 2) طلبات التصوير
-- ---------------------------------------------------------------------------
create table if not exists radiology_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  ordering_doctor_id uuid references doctors(id) on delete set null,
  visit_id uuid references patient_visits(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  sales_invoice_id uuid references sales_invoices(id) on delete set null,
  status text not null default 'ordered' check (status in (
    'ordered','scheduled','in_progress','completed','reported','cancelled'
  )),
  priority text not null default 'routine' check (priority in ('routine','urgent','stat')),
  clinical_indication text,          -- السبب السريري للطلب (مهم لتوجيه الأخصائي أثناء القراءة)
  scheduled_at timestamptz,
  ordered_at timestamptz not null default now(),
  completed_at timestamptz,
  reported_at timestamptz,
  reported_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_radiology_orders_org on radiology_orders(organization_id);
create index if not exists idx_radiology_orders_patient on radiology_orders(patient_id);
create index if not exists idx_radiology_orders_status on radiology_orders(organization_id, status);

create table if not exists radiology_order_items (
  id uuid primary key default gen_random_uuid(),
  radiology_order_id uuid not null references radiology_orders(id) on delete cascade,
  radiology_exam_id uuid not null references radiology_exams(id) on delete restrict,
  performed_by uuid references auth.users(id),  -- فني الأشعة الذي نفّذ التصوير
  performed_at timestamptz,
  findings text,                      -- الموجودات (يكتبها الأخصائي/الطبيب)
  impression text,                    -- الانطباع التشخيصي الموجز
  is_urgent_finding boolean not null default false, -- تمييز يدوي لموجودة تستدعي تنبيهًا فوريًا للطبيب الطالب
  created_at timestamptz not null default now()
);
create index if not exists idx_radiology_order_items_order on radiology_order_items(radiology_order_id);

-- ---------------------------------------------------------------------------
-- 3) الصور المرفقة (JPEG/PNG من جهاز التصوير أو ملف DICOM مُصدَّر، وليس DICOM حيًا)
-- ---------------------------------------------------------------------------
create table if not exists radiology_images (
  id uuid primary key default gen_random_uuid(),
  radiology_order_item_id uuid not null references radiology_order_items(id) on delete cascade,
  file_url text not null,
  file_name text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4) Trigger: عند تنفيذ كل بنود الطلب (performed_at مملوء للجميع) → الحالة completed
--    (إنجاز التصوير فعليًا، بصرف النظر عن وجود تقرير مكتوب بعد أو لا)
-- ---------------------------------------------------------------------------
create or replace function app_radiology_order_auto_complete()
returns trigger
language plpgsql
as $$
declare
  target_order_id uuid;
  remaining_count int;
begin
  target_order_id := coalesce(new.radiology_order_id, old.radiology_order_id);

  select count(*) into remaining_count
  from radiology_order_items
  where radiology_order_id = target_order_id and performed_at is null;

  if remaining_count = 0 then
    update radiology_orders
    set status = 'completed', completed_at = now()
    where id = target_order_id and status in ('ordered','scheduled','in_progress');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_radiology_order_auto_complete on radiology_order_items;
create trigger trg_radiology_order_auto_complete
after insert or update of performed_at on radiology_order_items
for each row execute function app_radiology_order_auto_complete();

-- ---------------------------------------------------------------------------
-- 5) عرض حيّ: الطلبات التي أُنجز تصويرها لكن لم يُكتب تقريرها بعد — أولوية الأخصائي
-- ---------------------------------------------------------------------------
create or replace view v_radiology_unreported_orders as
select
  o.id as radiology_order_id,
  o.organization_id,
  o.patient_id,
  p.name_ar as patient_name,
  o.ordering_doctor_id,
  d.name_ar as doctor_name,
  o.status,
  o.priority,
  o.ordered_at,
  o.completed_at,
  count(oi.id) as exams_count,
  count(oi.id) filter (where oi.findings is not null) as findings_written_count,
  count(oi.id) filter (where oi.is_urgent_finding) as urgent_findings_count
from radiology_orders o
join patients p on p.id = o.patient_id
left join doctors d on d.id = o.ordering_doctor_id
left join radiology_order_items oi on oi.radiology_order_id = o.id
where o.status in ('ordered','scheduled','in_progress','completed')
group by o.id, o.organization_id, o.patient_id, p.name_ar, o.ordering_doctor_id, d.name_ar, o.status, o.priority, o.ordered_at, o.completed_at;

-- ---------------------------------------------------------------------------
-- 6) بيانات مرجعية: فئات أجهزة افتراضية عامة
-- ---------------------------------------------------------------------------
insert into radiology_exam_categories (organization_id, name_ar, name_en, sort_order)
select null, v.name_ar, v.name_en, v.sort_order
from (values
  ('أشعة سينية (X-Ray)', 'X-Ray', 10),
  ('أشعة مقطعية (CT)', 'CT Scan', 20),
  ('رنين مغناطيسي (MRI)', 'MRI', 30),
  ('أشعة فوق صوتية (Ultrasound)', 'Ultrasound', 40),
  ('تصوير الثدي (Mammography)', 'Mammography', 50),
  ('تنظير بالأشعة (Fluoroscopy)', 'Fluoroscopy', 60)
) as v(name_ar, name_en, sort_order)
where not exists (
  select 1 from radiology_exam_categories c where c.organization_id is null and c.name_en = v.name_en
);

-- ---------------------------------------------------------------------------
-- Row Level Security — نفس نمط المختبر (0013): أعضاء المؤسسة فقط
-- ---------------------------------------------------------------------------
alter table radiology_exam_categories enable row level security;
alter table radiology_exams enable row level security;
alter table radiology_orders enable row level security;
alter table radiology_order_items enable row level security;
alter table radiology_images enable row level security;

create policy "radiology_exam_categories_read" on radiology_exam_categories
  for select using (organization_id is null or app_is_member(organization_id));
create policy "radiology_exam_categories_manage_admins" on radiology_exam_categories
  for insert with check (app_is_org_admin(organization_id));
create policy "radiology_exam_categories_update_admins" on radiology_exam_categories
  for update using (app_is_org_admin(organization_id));

create policy "radiology_exams_all_members" on radiology_exams
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "radiology_orders_all_members" on radiology_orders
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "radiology_order_items_all_members" on radiology_order_items
  for all using (
    exists (select 1 from radiology_orders o where o.id = radiology_order_items.radiology_order_id and app_is_member(o.organization_id))
  )
  with check (
    exists (select 1 from radiology_orders o where o.id = radiology_order_items.radiology_order_id and app_is_member(o.organization_id))
  );

create policy "radiology_images_all_members" on radiology_images
  for all using (
    exists (
      select 1 from radiology_order_items oi
      join radiology_orders o on o.id = oi.radiology_order_id
      where oi.id = radiology_images.radiology_order_item_id and app_is_member(o.organization_id)
    )
  )
  with check (
    exists (
      select 1 from radiology_order_items oi
      join radiology_orders o on o.id = oi.radiology_order_id
      where oi.id = radiology_images.radiology_order_item_id and app_is_member(o.organization_id)
    )
  );

-- ============================================================================
-- نهاية 0014_radiology.sql
-- ============================================================================
