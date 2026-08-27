-- ============================================================================
-- 0026_internal_messages.sql
-- المرحلة 7.2 — معالجة فجوة موثَّقة: دردشة داخلية فعلية بين المستخدمين
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0025 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- المشكلة الموثَّقة منذ المرحلة 5.3: `internal_messaging_settings` (0009)
-- هي إعدادات فقط (تفعيل/تعطيل، مدة الاستعلام، صلاحيات العرض/الحذف...) ولا
-- يوجد جدول محادثات/رسائل فعلي تعمل هذه الإعدادات عليه. `message_log` (0009)
-- هو أرشيف إشعارات **خارجية للمرضى** (SMS/بريد/تذكيرات) ولا صلة له بمحادثات
-- فريق العمل الداخلية. هذا الملف يبني الجدول الفعلي الناقص.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) المحادثات (ثنائية أو جماعية)
-- ---------------------------------------------------------------------------
create table if not exists internal_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  is_group boolean not null default false,
  name_ar text,    -- إلزامي فعليًا للمحادثات الجماعية فقط (يُفرَض من الواجهة لا قيد صارم، لمرونة إعادة التسمية)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()   -- يُحدَّث تلقائيًا عبر Trigger لفرز المحادثات بالأحدث
);
create index if not exists idx_internal_conversations_org on internal_conversations (organization_id, last_message_at desc);

-- ---------------------------------------------------------------------------
-- 2) المشاركون في كل محادثة
-- ---------------------------------------------------------------------------
create table if not exists internal_conversation_participants (
  conversation_id uuid not null references internal_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,     -- لحساب عدد الرسائل غير المقروءة بلا جدول إضافي
  primary key (conversation_id, user_id)
);
create index if not exists idx_internal_participants_user on internal_conversation_participants (user_id);

-- ---------------------------------------------------------------------------
-- 3) الرسائل
-- ---------------------------------------------------------------------------
create table if not exists internal_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  conversation_id uuid not null references internal_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz    -- حذف ناعم: تبقى الرسالة في الأرشيف لكن لا تُعرَض في الواجهة
);
create index if not exists idx_internal_messages_conversation on internal_messages (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- تحديث وقت آخر رسالة في المحادثة تلقائيًا — تُستخدَم لفرز قائمة المحادثات
-- بالأحدث أولًا بلا حاجة لاستعلام فرعي مكلف في كل تحميل شاشة
-- ---------------------------------------------------------------------------
create or replace function app_touch_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  update internal_conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_conversation_last_message on internal_messages;
create trigger trg_touch_conversation_last_message
  after insert on internal_messages
  for each row execute function app_touch_conversation_last_message();

-- ---------------------------------------------------------------------------
-- منع تكرار محادثة ثنائية بين نفس الشخصين مرتين — دالة مساعدة تبحث عن محادثة
-- ثنائية قائمة بين مستخدمين قبل إنشاء محادثة جديدة (تُستخدَم من الواجهة)
-- ---------------------------------------------------------------------------
create or replace function app_find_or_note_direct_conversation(p_organization_id uuid, p_user_a uuid, p_user_b uuid)
returns uuid
language sql
security definer
stable
as $$
  select c.id
  from internal_conversations c
  where c.organization_id = p_organization_id
    and c.is_group = false
    and exists (select 1 from internal_conversation_participants p where p.conversation_id = c.id and p.user_id = p_user_a)
    and exists (select 1 from internal_conversation_participants p where p.conversation_id = c.id and p.user_id = p_user_b)
    and (select count(*) from internal_conversation_participants p where p.conversation_id = c.id) = 2
  limit 1;
$$;

comment on function app_find_or_note_direct_conversation(uuid, uuid, uuid) is
  'تبحث عن محادثة ثنائية قائمة بين مستخدمين؛ تُستدعى من الواجهة قبل إنشاء محادثة جديدة لمنع تكرار محادثات ثنائية متعددة بين نفس الشخصين.';

-- ---------------------------------------------------------------------------
-- عرض: عدد الرسائل غير المقروءة لكل مستخدم في كل محادثة يشارك بها
-- (يعتمد على last_read_at بدل جدول "مقروء/غير مقروء" منفصل لكل رسالة)
-- ---------------------------------------------------------------------------
create or replace view v_internal_unread_counts as
select
  p.user_id,
  p.conversation_id,
  c.organization_id,
  count(m.id) as unread_count
from internal_conversation_participants p
join internal_conversations c on c.id = p.conversation_id
left join internal_messages m on m.conversation_id = p.conversation_id
  and m.deleted_at is null
  and m.sender_id <> p.user_id
  and (p.last_read_at is null or m.created_at > p.last_read_at)
group by p.user_id, p.conversation_id, c.organization_id;

-- ---------------------------------------------------------------------------
-- عرض: دليل أعضاء المؤسسة بأسماء معروضة — يُستخدَم لاختيار من تبدأ معه
-- محادثة. الاسم يُستخرَج من doctors/employees المرتبطين بنفس user_id إن
-- وُجد (نمط user_id الموجود أصلًا في كليهما)، وإلا يظهر معرّف المستخدم فقط
-- ---------------------------------------------------------------------------
create or replace view v_organization_members_directory as
select
  m.organization_id,
  m.user_id,
  m.role_key,
  coalesce(d.name_ar, e.name_ar, 'مستخدم ' || substring(m.user_id::text, 1, 8)) as display_name
from organization_memberships m
left join doctors d on d.user_id = m.user_id and d.organization_id = m.organization_id
left join employees e on e.user_id = m.user_id and e.organization_id = m.organization_id
where m.is_active = true;

-- ============================================================================
-- تفعيل Row Level Security (RLS) — يحترم إعدادات المؤسسة من
-- internal_messaging_settings (view_permission_scope / delete_permission_scope)
-- بدل افتراض سلوك واحد ثابت لكل المؤسسات
-- ============================================================================
alter table internal_conversations enable row level security;
alter table internal_conversation_participants enable row level security;
alter table internal_messages enable row level security;

-- رؤية المحادثة: أنت مشارك فيها، أو مدير المؤسسة إن كان نطاق العرض في
-- إعدادات المؤسسة = 'all' (رقابة إدارية اختيارية يُفعِّلها المالك بنفسه)
create policy "internal_conversations_select" on internal_conversations
  for select using (
    exists (select 1 from internal_conversation_participants p where p.conversation_id = internal_conversations.id and p.user_id = auth.uid())
    or (
      app_is_org_admin(organization_id)
      and coalesce((select s.view_permission_scope from internal_messaging_settings s where s.organization_id = internal_conversations.organization_id), 'own') = 'all'
    )
  );
create policy "internal_conversations_insert" on internal_conversations
  for insert with check (app_is_member(organization_id));

create policy "internal_participants_select" on internal_conversation_participants
  for select using (
    exists (select 1 from internal_conversation_participants p2 where p2.conversation_id = internal_conversation_participants.conversation_id and p2.user_id = auth.uid())
  );
create policy "internal_participants_insert" on internal_conversation_participants
  for insert with check (
    exists (select 1 from internal_conversations c where c.id = internal_conversation_participants.conversation_id and app_is_member(c.organization_id))
  );
create policy "internal_participants_update_own" on internal_conversation_participants
  for update using (user_id = auth.uid());

create policy "internal_messages_select" on internal_messages
  for select using (
    exists (select 1 from internal_conversation_participants p where p.conversation_id = internal_messages.conversation_id and p.user_id = auth.uid())
    or (
      app_is_org_admin(organization_id)
      and coalesce((select s.view_permission_scope from internal_messaging_settings s where s.organization_id = internal_messages.organization_id), 'own') = 'all'
    )
  );
create policy "internal_messages_insert" on internal_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (select 1 from internal_conversation_participants p where p.conversation_id = internal_messages.conversation_id and p.user_id = auth.uid())
  );
create policy "internal_messages_update_soft_delete" on internal_messages
  for update using (
    sender_id = auth.uid()
    or (
      app_is_org_admin(organization_id)
      and coalesce((select s.delete_permission_scope from internal_messaging_settings s where s.organization_id = internal_messages.organization_id), 'own') = 'all'
    )
  );

-- ============================================================================
-- نهاية 0026_internal_messages.sql
-- الخطوة التالية: ربط المحاسبة بالفواتير/السندات — يحتاج تأكيد المستخدم
-- الصريح على "خريطة الحسابات" (أي حساب في دليل الحسابات يقابل أي نوع فاتورة)
-- قبل كتابة أي Trigger ترحيل تلقائي، تمامًا كما وُثِّق في شاشة المحاسبة نفسها
-- ============================================================================
