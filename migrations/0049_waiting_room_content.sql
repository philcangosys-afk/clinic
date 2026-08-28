-- ---------------------------------------------------------------------------
-- 0049_waiting_room_content.sql — محتوى شاشات غرف الانتظار
-- ---------------------------------------------------------------------------
-- لماذا هذه الهجرة:
--   عنصر "المحتوى" موجود في القائمة الجانبية منذ بناء `module-registry`، لكن
--   الضغط عليه يفتح بطاقة "قيد الإنشاء" — لا مسار له في `App.tsx` ولا جدول
--   يخصّه في القاعدة. وهو أحد عنصرين فقط في القائمة بهذا الوصف (الثاني
--   "الأمراض والتشخيص"، ومحتواه موجود فعلًا في شاشة البيانات المرجعية فوُجِّه
--   إليها بدل بناء نسخة ثانية).
--
--   المواصفة (لقطة 77) تحدّده بأمرين:
--     • نصوص الشريط الأخباري لشاشات الانتظار
--     • شاشات الدور — إعداد شاشات TV لغرف الانتظار
--
-- نطاق مقصود ومحدود:
--   لا أبني محرّك عرض ولا صفحة TV هنا. هذان جدولا **إعداد** فقط: ما الذي
--   يُكتب على الشريط، وأي عيادات تعرضها كل شاشة. صفحة العرض نفسها (التي
--   تُفتح على التلفزيون) بناء مستقل يقرأ من هذين الجدولين — والمواصفة تصفها
--   بسطر واحد ("موثّق جزئيًا")، فبناؤها تخمينًا يعني واجهة تُرمى لاحقًا.

-- ---------------------------------------------------------------------------
-- 1) نصوص الشريط الأخباري
-- ---------------------------------------------------------------------------
create table if not exists waiting_room_tickers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  body text not null,
  -- الجدولة اختيارية: رسالة "إجازة العيد من كذا إلى كذا" تُكتب مرة وتختفي
  -- وحدها. تركها بلا تواريخ يعني رسالة دائمة.
  starts_on date,
  ends_on date,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- تاريخ نهاية قبل البداية يجعل الرسالة غير قابلة للظهور أبدًا بلا أن يفهم
  -- المستخدم لماذا — القاعدة ترفضه بدل أن تبتلعه.
  constraint waiting_room_tickers_dates_ck check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists idx_waiting_room_tickers_org on waiting_room_tickers (organization_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- 2) شاشات الدور
-- ---------------------------------------------------------------------------
create table if not exists queue_display_screens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  name text not null,
  -- مصفوفة معرّفات لا جدول ربط: الشاشة تعرض عيادةً أو عدة عيادات، والقائمة
  -- تُقرأ كاملةً دائمًا ولا يُستعلم عنها بالعكس. جدول ربط هنا يضيف صفًا
  -- وانضمامًا بلا سؤال يجيب عنه. فارغة = كل عيادات الفرع.
  clinic_ids uuid[] not null default '{}',
  show_doctor_name boolean not null default true,
  show_ticker boolean not null default true,
  refresh_seconds integer not null default 10 check (refresh_seconds between 3 and 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index if not exists idx_queue_display_screens_org on queue_display_screens (organization_id, is_active);

-- ---------------------------------------------------------------------------
-- RLS — نفس النمط الموحّد في المشروع
-- ---------------------------------------------------------------------------
alter table waiting_room_tickers enable row level security;
alter table queue_display_screens enable row level security;

drop policy if exists "waiting_room_tickers_all_members" on waiting_room_tickers;
create policy "waiting_room_tickers_all_members" on waiting_room_tickers
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

drop policy if exists "queue_display_screens_all_members" on queue_display_screens;
create policy "queue_display_screens_all_members" on queue_display_screens
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ---------------------------------------------------------------------------
-- التدقيق — نفس تغطية 0048
-- ---------------------------------------------------------------------------
drop trigger if exists trg_audit_waiting_room_tickers on waiting_room_tickers;
create trigger trg_audit_waiting_room_tickers
  after insert or update or delete on waiting_room_tickers
  for each row execute function app_audit_log_auto('body');

drop trigger if exists trg_audit_queue_display_screens on queue_display_screens;
create trigger trg_audit_queue_display_screens
  after insert or update or delete on queue_display_screens
  for each row execute function app_audit_log_auto('name');
