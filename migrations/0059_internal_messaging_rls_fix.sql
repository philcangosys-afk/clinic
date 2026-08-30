-- ---------------------------------------------------------------------------
-- 0059_internal_messaging_rls_fix.sql — كسر التكرار اللانهائي في RLS
--                                       وتأمين دالة المحادثات
-- ---------------------------------------------------------------------------
-- **العطل:** الرسائل الداخلية تُعيد 500 دائمًا:
--
--     42P17: infinite recursion detected in policy for relation
--            "internal_conversation_participants"
--
-- السبب في 0026: سياسة القراءة على `internal_conversation_participants`
-- تستعلم من **الجدول نفسه**:
--
--     using (exists (select 1 from internal_conversation_participants p2
--                     where p2.conversation_id = …conversation_id
--                       and p2.user_id = auth.uid()))
--
-- فتقييم السياسة يقرأ الجدول، وقراءة الجدول تُقيّم السياسة، بلا قاع.
--
-- والأثر أوسع مما يبدو: ثلاث سياسات أخرى (قراءة المحادثات، قراءة الرسائل،
-- إدراج الرسائل) تستعلم هي أيضًا من جدول المشاركين، فتُشعل سياسته وتقع في
-- نفس التكرار. أي أن **موديول الرسائل الداخلية كله معطَّل**، لا شاشة واحدة
-- منه — ومنها `v_internal_unread_counts` الذي تستدعيه لوحة التحكم في كل
-- تحميل، فتتكرر أخطاء 500 في السجل.
--
-- **الحل:** دالة `security definer` تفحص المشاركة. الدالة تُنفَّذ بصلاحيات
-- مالكها فتتجاوز RLS، فتقرأ الجدول بلا إشعال سياسته — وهذا هو الكسر الصحيح
-- للحلقة، لا تخفيفًا للحماية: الدالة لا تُجيب إلا عن سؤال واحد محدود («هل
-- المستخدم الحالي مشارك في هذه المحادثة؟») ولا تُعيد أي بيانات.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) دالة فحص المشاركة
--
-- `stable` لا `volatile`: تُستدعى مرة لكل صف في الاستعلام الواحد، والمخطِّط
-- لا يستطيع تخزين نتيجة دالة متغيّرة — فالفرق في الأداء كبير على محادثة
-- طويلة.
--
-- `auth.uid()` داخل الدالة لا كمعامل: تمريره معاملًا كان يسمح لأي مستدعٍ
-- بالسؤال عن مشاركة **غيره**، وهو تسريب لا لزوم له.
-- ---------------------------------------------------------------------------
create or replace function app_is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from internal_conversation_participants p
     where p.conversation_id = p_conversation_id
       and p.user_id = auth.uid()
  );
$$;

comment on function app_is_conversation_participant(uuid) is
  'هل المستخدم الحالي مشارك في المحادثة؟ دالة security definer لكسر التكرار اللانهائي في سياسات RLS للرسائل الداخلية (42P17). لا تُعيد بيانات، جوابها منطقي فقط.';

revoke all on function app_is_conversation_participant(uuid) from public, anon;
grant execute on function app_is_conversation_participant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) إعادة كتابة السياسات الأربع لتستدعي الدالة
--
-- تُعاد كتابة سياسات المحادثات والرسائل أيضًا وإن لم تكن هي مصدر الحلقة:
-- استعلامها المباشر من جدول المشاركين يُشعل سياسته، فتقع في التكرار نفسه.
-- استبدال الاستعلام بالدالة يقطع ذلك من الجذر، ويجعل قاعدة «من يرى ماذا»
-- معرَّفة في موضع واحد بدل أربعة.
-- ---------------------------------------------------------------------------

drop policy if exists "internal_participants_select" on internal_conversation_participants;
create policy "internal_participants_select" on internal_conversation_participants
  for select using (app_is_conversation_participant(conversation_id));

drop policy if exists "internal_conversations_select" on internal_conversations;
create policy "internal_conversations_select" on internal_conversations
  for select using (
    app_is_conversation_participant(id)
    or (
      app_is_org_admin(organization_id)
      and coalesce((select s.view_permission_scope
                      from internal_messaging_settings s
                     where s.organization_id = internal_conversations.organization_id), 'own') = 'all'
    )
  );

drop policy if exists "internal_messages_select" on internal_messages;
create policy "internal_messages_select" on internal_messages
  for select using (
    app_is_conversation_participant(conversation_id)
    or (
      app_is_org_admin(organization_id)
      and coalesce((select s.view_permission_scope
                      from internal_messaging_settings s
                     where s.organization_id = internal_messages.organization_id), 'own') = 'all'
    )
  );

drop policy if exists "internal_messages_insert" on internal_messages;
create policy "internal_messages_insert" on internal_messages
  for insert with check (
    sender_id = auth.uid()
    and app_is_conversation_participant(conversation_id)
  );

-- ---------------------------------------------------------------------------
-- 3) عدّاد غير المقروء: صفوف المستخدم نفسه فقط
--
-- المنظور كان يُعيد صفوف كل المشاركين في محادثاتك — أي عدّاد «غير المقروء»
-- الخاص بزملائك. الواجهة تُصفّي بـ`user_id` فلم يظهر الأثر، لكن التصفية في
-- العميل ليست حماية: من يستدعي المنظور مباشرةً يرى متى قرأ كل زميل رسائله.
-- الشرط هنا يجعلها حقيقة في القاعدة.
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
where p.user_id = auth.uid()
group by p.user_id, p.conversation_id, c.organization_id;

alter view v_internal_unread_counts set (security_invoker = on);
revoke all on v_internal_unread_counts from anon;
grant select on v_internal_unread_counts to authenticated;

-- ---------------------------------------------------------------------------
-- 4) تأمين `app_find_or_note_direct_conversation`
--
-- حالها في 0026: `security definer` بلا `search_path` ثابت، وتنفيذها مُتاح
-- لـ`public` و`anon`. ثلاثة عيوب متمايزة:
--
--   • **`search_path` متغيّر** مع `security definer` هو النمط الذي يحذّر منه
--     مدقّق Supabase (0011_function_search_path_mutable): من يستطيع إنشاء
--     مخطَّط في مسار البحث يستطيع تغطية `internal_conversations` بجدول من
--     عنده، فتُنفَّذ الدالة عليه بصلاحيات المالك.
--
--   • **`anon` يستطيع التنفيذ**: زائر غير مسجَّل يستطيع سؤال القاعدة عن وجود
--     محادثة بين شخصين بعينهما.
--
--   • **لا فحص للهوية**: الدالة تتجاوز RLS بحكم `definer`، فأي عضو كان
--     يستطيع الحصول على معرّف محادثة **بين طرفين آخرين** لا شأن له بها.
--     الفحوص الثلاثة أدناه تُغلق ذلك: تسجيل دخول، عضوية في المنشأة، وأن
--     يكون المستدعي أحد الطرفين.
-- ---------------------------------------------------------------------------
drop function if exists app_find_or_note_direct_conversation(uuid, uuid, uuid);

create or replace function app_find_or_note_direct_conversation(
  p_organization_id uuid,
  p_user_a uuid,
  p_user_b uuid
)
returns uuid
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if auth.uid() not in (p_user_a, p_user_b) then
    raise exception 'لا يمكنك البحث عن محادثة لست طرفًا فيها';
  end if;

  select c.id into v_id
    from internal_conversations c
   where c.organization_id = p_organization_id
     and c.is_group = false
     and exists (select 1 from internal_conversation_participants p
                  where p.conversation_id = c.id and p.user_id = p_user_a)
     and exists (select 1 from internal_conversation_participants p
                  where p.conversation_id = c.id and p.user_id = p_user_b)
     and (select count(*) from internal_conversation_participants p
           where p.conversation_id = c.id) = 2
   limit 1;

  return v_id;
end;
$$;

comment on function app_find_or_note_direct_conversation(uuid, uuid, uuid) is
  'تبحث عن محادثة ثنائية قائمة بين مستخدمين، بشرط أن يكون المستدعي أحد طرفيها وعضوًا في المنشأة. تُستدعى قبل إنشاء محادثة جديدة لمنع تكرار المحادثات الثنائية.';

revoke all on function app_find_or_note_direct_conversation(uuid, uuid, uuid) from public, anon;
grant execute on function app_find_or_note_direct_conversation(uuid, uuid, uuid) to authenticated;

commit;
