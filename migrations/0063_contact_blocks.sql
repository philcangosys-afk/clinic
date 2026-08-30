-- ---------------------------------------------------------------------------
-- 0063_contact_blocks.sql — الجهات المحجوبة: بيانات كاملة وفرضٌ من القاعدة
-- ---------------------------------------------------------------------------
-- `blocked_external_contacts` موجود منذ 0002 بأربعة حقول (اسم، جوال، هوية،
-- سبب) — **ولا شيء يفرضه**. لا مُحفِّز، ولا دالة، ولا سطر في مسار الحجز. أي
-- أن الحظر كان قائمة تُقرأ ولا تمنع شيئًا: يُسجَّل الشخص محظورًا ثم يحجز
-- موعدًا بعد دقيقة.
--
-- وينقصه ما يجعله قابلًا للاستعمال أصلًا:
--   • لا ربط بمريض — الحظر بالاسم والجوال فقط، فمريضٌ في النظام لا يُحظر.
--   • لا نوع — حظر الحجز وحظر الرسائل شيء واحد، فمن أوقفنا رسائله منعناه
--     من العلاج.
--   • لا مدّة — كل حظر دائم، فلا يوجد «حظر شهر».
--   • لا رفع — الرفع يعني الحذف، فيضيع أثر أنه حُظر يومًا ولماذا.
--
-- هذا الملف يُكمل الجدول القائم (لا يستبدله) ويضيف الدالة المركزية التي
-- تُستشار من القاعدة في كل مسار.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) إكمال الجدول
-- ---------------------------------------------------------------------------
alter table blocked_external_contacts
  add column if not exists patient_id  uuid references patients(id) on delete cascade,
  add column if not exists block_type  text not null default 'all',
  add column if not exists starts_at   timestamptz not null default now(),
  add column if not exists ends_at     timestamptz,
  add column if not exists is_active   boolean not null default true,
  add column if not exists notes       text,
  add column if not exists lifted_by   uuid references auth.users(id),
  add column if not exists lifted_at   timestamptz,
  add column if not exists lift_reason text;

alter table blocked_external_contacts drop constraint if exists blocked_contacts_type_check;
alter table blocked_external_contacts add constraint blocked_contacts_type_check
  check (block_type in ('booking', 'messaging', 'all'));

-- سجل بلا مريض وبلا جوال لا يمنع شيئًا ولا يُطابَق: يُرفض عند الإدخال بدل
-- أن يجلس في القائمة موهمًا بحماية غير قائمة.
alter table blocked_external_contacts drop constraint if exists blocked_contacts_target_check;
alter table blocked_external_contacts add constraint blocked_contacts_target_check
  check (patient_id is not null or nullif(btrim(mobile_number), '') is not null);

alter table blocked_external_contacts drop constraint if exists blocked_contacts_period_check;
alter table blocked_external_contacts add constraint blocked_contacts_period_check
  check (ends_at is null or ends_at > starts_at);

create index if not exists idx_blocked_contacts_active
  on blocked_external_contacts (organization_id, is_active) where is_active;
create index if not exists idx_blocked_contacts_patient
  on blocked_external_contacts (patient_id) where patient_id is not null;

-- عزل المنشآت: حظر مريض من منشأة أخرى لا معنى له.
alter table blocked_external_contacts drop constraint if exists blocked_contacts_patient_tenant_fk;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'patients_organization_id_id_key') then
    alter table blocked_external_contacts add constraint blocked_contacts_patient_tenant_fk
      foreign key (organization_id, patient_id) references patients(organization_id, id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) توحيد أرقام الجوال قبل المقارنة
--
-- الرقم نفسه يُكتب بأربع صور: 0501234567، +966501234567، 966501234567،
-- 0501-234-567. المقارنة النصّية المباشرة تجعل الحظر يُفلت بمسافة واحدة.
-- تُقارَن آخر تسعة أرقام: يتجاوز ذلك رمز الدولة والصفر البادئ معًا.
-- ---------------------------------------------------------------------------
create or replace function app_normalize_mobile(p_mobile text)
returns text
language sql
immutable
as $$
  select nullif(right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 9), '');
$$;

-- ---------------------------------------------------------------------------
-- 3) الدالة المركزية
--
-- تُعيد `true` إذا كان **ممنوعًا**. وتشمل أيضًا أعلام الحظر في `patients`
-- (`block_appointments` و`block_sms`) الموجودة منذ 0002: توحيدها هنا يجعل
-- سؤال «هل هذا الشخص ممنوع؟» له جواب واحد في النظام كله، بدل مصدرين قد
-- يتناقضان.
-- ---------------------------------------------------------------------------
create or replace function app_check_contact_block(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_mobile_number   text,
  p_action          text
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    exists (
      select 1
        from blocked_external_contacts b
       where b.organization_id = p_organization_id
         and b.is_active
         and b.starts_at <= now()
         and (b.ends_at is null or b.ends_at > now())
         and (b.block_type = p_action or b.block_type = 'all')
         and (
           (p_patient_id is not null and b.patient_id = p_patient_id)
           or (
             app_normalize_mobile(p_mobile_number) is not null
             and app_normalize_mobile(b.mobile_number) = app_normalize_mobile(p_mobile_number)
           )
         )
    )
    or exists (
      select 1
        from patients p
       where p.id = p_patient_id
         and p.organization_id = p_organization_id
         and (
           (p_action = 'booking'   and p.block_appointments)
           or (p_action = 'messaging' and p.block_sms)
         )
    );
$$;

comment on function app_check_contact_block(uuid, uuid, text, text) is
  'هل هذا المريض أو الرقم ممنوع من الإجراء (booking / messaging)؟ يشمل سجل الجهات المحجوبة وأعلام الحظر في ملف المريض معًا.';

revoke all on function app_check_contact_block(uuid, uuid, text, text) from public, anon;
grant execute on function app_check_contact_block(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) الفرض — في القاعدة لا في الواجهة
--
-- مُحفِّز على `appointments` لا فحصٌ في كل شاشة: مسارات إنشاء الموعد أربعة
-- (الحجز العادي، المريض الحضوري، تحويل قائمة الانتظار، والحجز الإلكتروني
-- لاحقًا)، وفحصٌ في كل واحد منها يعني أربع فرص للنسيان — وقد نُسيت أربعتها
-- فعلًا. المُحفِّز يغطيها كلها وما يأتي بعدها.
--
-- على الإدخال وحده: موعد قائم لمريض حُظر بعد حجزه يُلغى بقرار بشري، ولا
-- يُجمَّد تعديله فيمنع حتى تسجيل «عدم الحضور».
-- ---------------------------------------------------------------------------
create or replace function app_enforce_booking_block()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mobile text;
  v_reason text;
begin
  select p.mobile_number into v_mobile from patients p where p.id = new.patient_id;

  if app_check_contact_block(new.organization_id, new.patient_id, v_mobile, 'booking') then
    select coalesce(nullif(btrim(b.reason), ''), 'بلا سبب مسجَّل')
      into v_reason
      from blocked_external_contacts b
     where b.organization_id = new.organization_id
       and b.is_active
       and b.starts_at <= now()
       and (b.ends_at is null or b.ends_at > now())
       and b.block_type in ('booking', 'all')
       and (b.patient_id = new.patient_id
            or app_normalize_mobile(b.mobile_number) = app_normalize_mobile(v_mobile))
     order by b.created_at desc
     limit 1;

    raise exception 'هذا المريض محظور من حجز المواعيد — السبب: %. ارفع الحظر من شاشة الجهات المحجوبة للمتابعة.',
      coalesce(v_reason, 'بلا سبب مسجَّل');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_booking_block on appointments;
create trigger trg_enforce_booking_block
before insert on appointments
for each row execute function app_enforce_booking_block();

-- الرسائل: تُمنع على مستوى `message_log`، فيغطي ذلك التذكيرات والرسائل
-- الجماعية والتأكيدات معًا — كلها تمرّ من هنا.
create or replace function app_enforce_messaging_block()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_mobile text;
begin
  if new.patient_id is null and nullif(btrim(new.external_recipient), '') is null then
    return new;
  end if;
  select p.mobile_number into v_mobile from patients p where p.id = new.patient_id;

  if app_check_contact_block(new.organization_id, new.patient_id,
                             coalesce(v_mobile, new.external_recipient), 'messaging') then
    -- لا استثناء: الرسالة تُسجَّل **ملغاة** لا تُرفض. رفعُ خطأ هنا كان
    -- سيُفشل تشغيل التذكيرات كله لأجل مريض واحد محظور؛ والتسجيل يُبقي الأثر
    -- ظاهرًا في سجل الرسائل بدل اختفاء صامت.
    new.status := 'cancelled';
    new.last_error := 'محظور من استقبال الرسائل';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_messaging_block on message_log;
create trigger trg_enforce_messaging_block
before insert on message_log
for each row execute function app_enforce_messaging_block();

-- ---------------------------------------------------------------------------
-- 5) رفع الحظر — تحديث لا حذف
--
-- السجل يبقى: «لماذا مُنع هذا المريض في مارس؟» سؤال يُطرح بعد أشهر، والحذف
-- يمحو جوابه. ويُسجَّل من رفعه ومتى ولماذا.
-- ---------------------------------------------------------------------------
create or replace function app_lift_contact_block(p_block_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid;
begin
  select organization_id into v_org from blocked_external_contacts where id = p_block_id;
  if v_org is null then
    raise exception 'سجل الحظر غير موجود';
  end if;
  if not app_has_permission(v_org, 'blocked_contacts.manage') then
    raise exception 'صلاحيتك لا تسمح برفع الحظر';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب رفع الحظر مطلوب';
  end if;

  update blocked_external_contacts
     set is_active   = false,
         lifted_by   = auth.uid(),
         lifted_at   = now(),
         lift_reason = btrim(p_reason)
   where id = p_block_id and is_active;

  if not found then
    raise exception 'الحظر مرفوع أصلًا';
  end if;
end;
$$;

revoke all on function app_lift_contact_block(uuid, text) from public, anon;
grant execute on function app_lift_contact_block(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) السياسات: القراءة لكل عضو، الكتابة بالصلاحية
-- ---------------------------------------------------------------------------
drop policy if exists "blocked_contacts_all_members" on blocked_external_contacts;
create policy "blocked_contacts_read" on blocked_external_contacts
  for select using (app_is_member(organization_id));
create policy "blocked_contacts_write" on blocked_external_contacts
  for insert with check (app_has_permission(organization_id, 'blocked_contacts.manage'));
create policy "blocked_contacts_update" on blocked_external_contacts
  for update using (app_has_permission(organization_id, 'blocked_contacts.manage'));

-- ---------------------------------------------------------------------------
-- 7) منظور العرض + التدقيق
-- ---------------------------------------------------------------------------
create or replace view v_blocked_contacts as
select
  b.id,
  b.organization_id,
  b.patient_id,
  p.name_ar        as patient_name,
  p.file_number    as patient_file_number,
  coalesce(p.mobile_number, b.mobile_number) as mobile_number,
  b.full_name,
  b.id_number,
  b.block_type,
  b.reason,
  b.notes,
  b.starts_at,
  b.ends_at,
  b.is_active,
  -- «نشط» في الشاشة يعني ساري الآن، لا مجرد `is_active`: حظرٌ ينتهي غدًا
  -- وحظرٌ انتهى أمس كلاهما `is_active` حتى يُرفع، والفرق بينهما هو كل شيء.
  (b.is_active and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())) as is_in_effect,
  b.created_by,
  b.created_at,
  b.lifted_by,
  b.lifted_at,
  b.lift_reason
from blocked_external_contacts b
left join patients p on p.id = b.patient_id;

alter view v_blocked_contacts set (security_invoker = on);
revoke all on v_blocked_contacts from anon;
grant select on v_blocked_contacts to authenticated;

drop trigger if exists trg_audit_blocked_contacts on blocked_external_contacts;
create trigger trg_audit_blocked_contacts
after insert or update or delete on blocked_external_contacts
for each row execute function app_audit_log_auto('reason');

commit;
