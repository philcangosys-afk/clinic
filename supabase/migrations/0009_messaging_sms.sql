-- ============================================================================
-- 0009_messaging_sms.sql
-- المرحلة 2 (تابع) — الرسائل والتنبيهات + نظام SMS المدفوع مسبقًا
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0008 مباشرة (يعتمد عليها جميعًا)
-- (لا يحتوي على أي مفاتيح أو أسرار — لا مفاتيح مزوّد SMS خام هنا أبدًا؛ أي مفتاح
--  API لمزوّد خارجي (Unifonic/Msegat/Twilio) يجب أن يبقى Secret على السيرفر فقط)
--
-- يغطي هذا الملف:
--   1) قوالب الرسائل لكل حدث نظامي (لقطة 90) + النصوص الجاهزة (لقطة 13 — ثغرة
--      موثّقة منذ الدفعة الأولى من المراجعة ولم تُبنَ بعد)
--   2) إعدادات نظام المراسلات الداخلي (لقطة 83)
--   3) أرشيف الرسائل (message_log) موحّد لكل القنوات (SMS/Email/داخلي)
--   4) رصيد SMS مدفوع مسبقًا + سجل حركاته + تنبيه تلقائي عند الانخفاض
--   5) Trigger: جدولة رسالة تذكير الموعد تلقائيًا (يحترم حجب SMS من ملف المريض
--      الموجود منذ 0002 — أول استهلاك فعلي لهذا الحقل في كل الملفات حتى الآن)
--   6) توسعة app_after_organization_created (من 0001) لتزرع القوالب الافتراضية
--      ورصيد SMS تلقائيًا لكل مؤسسة جديدة من لحظة إنشائها
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) قوالب الرسائل لكل حدث نظامي (لقطة 90)
-- ---------------------------------------------------------------------------
create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_key text not null check (event_key in (
    'file_opened','appointment_reminder','lab_results_ready','invoice_notification',
    'notes_reminder','document_expiry_alert','owner_notification','sms_balance_low'
  )),
  channel text not null default 'sms' check (channel in ('sms','email','internal')),
  template_text text not null,
  is_disabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (organization_id, event_key, channel)
);

-- النصوص الجاهزة حسب الموقع (لقطة 13) — Snippets سريعة الإدراج في الشاشة المرتبطة
create table if not exists canned_texts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  location_key text not null check (location_key in (
    'dental_board','medical_reports','referral_report','derma_clinic',
    'appointment_note','invoice_dosage_field','invoice_usage_field'
  )),
  text_ar text not null,
  text_en text,
  sort_order int not null default 0,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_canned_texts_location on canned_texts (organization_id, location_key);

-- ---------------------------------------------------------------------------
-- 2) إعدادات نظام المراسلات الداخلي (لقطة 83)
-- ---------------------------------------------------------------------------
create table if not exists internal_messaging_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  internal_chat_enabled boolean not null default true,
  poll_interval_seconds int not null default 15,
  online_timeout_seconds int not null default 60,
  view_permission_scope text not null default 'own' check (view_permission_scope in ('all','own')),
  delete_permission_scope text not null default 'own' check (delete_permission_scope in ('all','own')),
  notifications_enabled boolean not null default true,
  notify_by_role boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3) أرشيف الرسائل الموحّد (كل القنوات: SMS/Email/داخلي) — يخدم "كشف الرسائل"
--    و"أرشيف الرسائل" و"إرسال رسالة تبليغ المالك" في آن واحد
-- ---------------------------------------------------------------------------
create table if not exists message_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid references patients(id) on delete set null,
  recipient_user_id uuid references auth.users(id) on delete set null,   -- للرسائل الداخلية/تبليغ المالك
  external_recipient text,
  channel text not null default 'sms' check (channel in ('sms','email','internal')),
  event_key text,
  message_text text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','delivered')),
  provider_message_id text,
  sent_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_message_log_org_date on message_log (organization_id, created_at desc);
create index if not exists idx_message_log_patient on message_log (patient_id) where patient_id is not null;

-- ---------------------------------------------------------------------------
-- 4) رصيد SMS مدفوع مسبقًا (Prepaid Credits) + سجل حركاته
-- ---------------------------------------------------------------------------
create table if not exists sms_credit_balance (
  organization_id uuid primary key references organizations(id) on delete cascade,
  balance int not null default 0,
  low_balance_alert_threshold int not null default 50,
  updated_at timestamptz not null default now()
);

create table if not exists sms_credit_transactions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('top_up','consumption','adjustment')),
  amount int not null,     -- موجب لشحن الرصيد، سالب للاستهلاك
  related_message_id bigint references message_log(id) on delete set null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_sms_credit_tx_org on sms_credit_transactions (organization_id, created_at desc);

-- تحديث الرصيد تلقائيًا من كل حركة + تنبيه تلقائي للمالك عند لحظة العبور تحت الحد
-- الأدنى (مرة واحدة فقط عند العبور، وليس مع كل حركة استهلاك لتفادي تكرار التنبيه)
create or replace function app_apply_sms_credit_transaction()
returns trigger
language plpgsql
security definer
as $$
declare
  v_old_balance int;
  v_threshold int;
  v_new_balance int;
  v_owner_id uuid;
  v_template message_templates%rowtype;
begin
  select balance, low_balance_alert_threshold into v_old_balance, v_threshold
    from sms_credit_balance where organization_id = new.organization_id;

  if not found then
    v_old_balance := 0;
    v_threshold := 50;
    insert into sms_credit_balance (organization_id, balance, low_balance_alert_threshold)
    values (new.organization_id, 0, 50);
  end if;

  v_new_balance := v_old_balance + new.amount;

  update sms_credit_balance
    set balance = v_new_balance, updated_at = now()
    where organization_id = new.organization_id;

  if v_new_balance <= v_threshold and v_old_balance > v_threshold then
    select user_id into v_owner_id from organization_memberships
      where organization_id = new.organization_id and role_key = 'owner' and is_active = true
      limit 1;

    if v_owner_id is not null then
      select * into v_template from message_templates
        where organization_id = new.organization_id and event_key = 'sms_balance_low'
          and channel = 'internal' and is_disabled = false;

      if v_template.id is not null then
        insert into message_log (organization_id, recipient_user_id, channel, event_key, message_text, status)
        values (new.organization_id, v_owner_id, 'internal', 'sms_balance_low', v_template.template_text, 'queued');
      end if;
    end if;
  end if;

  return new;
end;
$$;
drop trigger if exists trg_sms_credit_transaction_apply on sms_credit_transactions;
create trigger trg_sms_credit_transaction_apply
  after insert on sms_credit_transactions
  for each row execute function app_apply_sms_credit_transaction();

-- استهلاك رصيد تلقائيًا (رسالة واحدة = وحدة واحدة) عند تحوّل حالة رسالة SMS إلى "أُرسلت"
-- (يُستدعى من السيرفر/Edge Function بعد التسليم الفعلي عبر مزوّد SMS الخارجي)
create or replace function app_consume_sms_credit_on_sent()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.channel = 'sms' and new.status = 'sent' and old.status is distinct from 'sent' then
    insert into sms_credit_transactions (organization_id, transaction_type, amount, related_message_id)
    values (new.organization_id, 'consumption', -1, new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_message_log_sms_consume on message_log;
create trigger trg_message_log_sms_consume
  after update on message_log
  for each row execute function app_consume_sms_credit_on_sent();

-- ---------------------------------------------------------------------------
-- 5) جدولة رسالة تذكير الموعد تلقائيًا — أول استهلاك فعلي لحقل patients.block_sms
--    (موجود منذ 0002 لكن لم يستخدمه أي منطق حتى الآن)
-- ---------------------------------------------------------------------------
create or replace function app_queue_appointment_reminder()
returns trigger
language plpgsql
security definer
as $$
declare
  v_template message_templates%rowtype;
  v_patient patients%rowtype;
begin
  select * into v_template from message_templates
    where organization_id = new.organization_id and event_key = 'appointment_reminder'
      and channel = 'sms' and is_disabled = false;
  if v_template.id is null then
    return new;
  end if;

  select * into v_patient from patients where id = new.patient_id;
  if v_patient.id is null or v_patient.block_sms then
    return new;
  end if;

  insert into message_log (organization_id, patient_id, channel, event_key, message_text, status)
  values (new.organization_id, new.patient_id, 'sms', 'appointment_reminder', v_template.template_text, 'queued');

  return new;
end;
$$;
drop trigger if exists trg_queue_appointment_reminder on appointments;
create trigger trg_queue_appointment_reminder
  after insert on appointments
  for each row execute function app_queue_appointment_reminder();

-- ---------------------------------------------------------------------------
-- 6) توسعة app_after_organization_created (من 0001) — تزرع رصيد SMS ابتدائي
--    (صفر) وقوالب الرسائل الافتراضية الثمانية تلقائيًا لكل مؤسسة جديدة، فور
--    الإنشاء وبلا أي خطوة إضافية من الواجهة الأمامية (نفس فلسفة الإصلاح الأصلي
--    في 0001 لثغرة Onboarding.tsx)
-- ---------------------------------------------------------------------------
create or replace function app_after_organization_created()
returns trigger
language plpgsql
security definer
as $$
declare
  main_branch_id uuid;
  clinic_default_features text[] := array[
    'core_dashboard','reception','appointments','patients','medical_records',
    'patient_journey','medical_services','departments_clinics','doctors',
    'prescriptions','billing_payments','hr','diagnosis','reports','audit_log','settings'
  ];
  medical_center_added_features text[] := array[
    'laboratory','radiology','pharmacy','dispensing','insurance_claims',
    'packages','accounting','procurement','inventory','messaging',
    'nursing','advanced_analytics'
  ];
  all_features text[];
  fkey text;
begin
  insert into branches (organization_id, name, is_main)
  values (new.id, new.name, true)
  returning id into main_branch_id;

  insert into organization_memberships (organization_id, user_id, branch_id, role_key, is_active)
  values (new.id, new.created_by, main_branch_id, 'owner', true);

  all_features := clinic_default_features;
  if new.organization_type = 'medical_center' then
    all_features := all_features || medical_center_added_features;
  end if;

  foreach fkey in array all_features loop
    insert into organization_features (organization_id, feature_key, enabled)
    values (new.id, fkey, true)
    on conflict (organization_id, feature_key) do nothing;
  end loop;

  insert into sms_credit_balance (organization_id, balance)
  values (new.id, 0)
  on conflict (organization_id) do nothing;

  insert into message_templates (organization_id, event_key, channel, template_text) values
    (new.id, 'file_opened', 'sms', 'مرحبًا {patient_name}، تم فتح ملفك الطبي بنجاح.'),
    (new.id, 'appointment_reminder', 'sms', 'تذكير: لديك موعد يوم {appointment_date} الساعة {appointment_time}.'),
    (new.id, 'lab_results_ready', 'sms', 'عزيزي {patient_name}، نتائج تحاليلك جاهزة الآن.'),
    (new.id, 'invoice_notification', 'sms', 'تم إصدار فاتورة بقيمة {invoice_amount} ريال.'),
    (new.id, 'notes_reminder', 'sms', 'تذكير بمتابعة: {note_text}'),
    (new.id, 'document_expiry_alert', 'internal', 'وثيقة على وشك الانتهاء: {document_title} بتاريخ {expiry_date}.'),
    (new.id, 'owner_notification', 'internal', 'تنبيه للمالك: {notification_text}'),
    (new.id, 'sms_balance_low', 'internal', 'تنبيه: رصيد الرسائل النصية منخفض ({balance} رسالة متبقية).')
  on conflict (organization_id, event_key, channel) do nothing;

  return new;
end;
$$;
drop trigger if exists trg_after_organization_created on organizations;
create trigger trg_after_organization_created
  after insert on organizations
  for each row execute function app_after_organization_created();

-- ============================================================================
-- تفعيل Row Level Security (RLS)
-- ============================================================================
alter table message_templates enable row level security;
alter table canned_texts enable row level security;
alter table internal_messaging_settings enable row level security;
alter table message_log enable row level security;
alter table sms_credit_balance enable row level security;
alter table sms_credit_transactions enable row level security;

create policy "message_templates_read_members" on message_templates
  for select using (app_is_member(organization_id));
create policy "message_templates_manage_admins" on message_templates
  for all using (app_is_org_admin(organization_id)) with check (app_is_org_admin(organization_id));

create policy "canned_texts_all_members" on canned_texts
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "internal_messaging_settings_read_members" on internal_messaging_settings
  for select using (app_is_member(organization_id));
create policy "internal_messaging_settings_insert_admins" on internal_messaging_settings
  for insert with check (app_is_org_admin(organization_id));
create policy "internal_messaging_settings_update_admins" on internal_messaging_settings
  for update using (app_is_org_admin(organization_id));

create policy "message_log_all_members" on message_log
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "sms_balance_read_members" on sms_credit_balance
  for select using (app_is_member(organization_id));
create policy "sms_balance_manage_admins" on sms_credit_balance
  for update using (app_is_org_admin(organization_id));

create policy "sms_transactions_read_members" on sms_credit_transactions
  for select using (app_is_member(organization_id));
create policy "sms_transactions_insert_admins" on sms_credit_transactions
  for insert with check (app_is_org_admin(organization_id));

-- ============================================================================
-- نهاية 0009_messaging_sms.sql
-- الخطوة التالية: 0010_reports.sql (تقارير الإيراد اليومي، إحصائيات المبيعات
--   والمواعيد، مؤشرات الأداء الحيّة (نسبة الخصم/التحصيل)، وقوالب طباعة A4/حراري)
-- ============================================================================
