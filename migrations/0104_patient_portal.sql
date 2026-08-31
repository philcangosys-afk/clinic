-- ============================================================================
-- 0104 — المرحلة 24: بوابة المريض
-- ============================================================================
-- **لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة**: لا رمز تحقّق برسالة، ولا
-- دعوة برسالة، ولا أيّ تكامل مزوّد. ربط حساب المريض ببوابته **يتمّ يدويًّا
-- من موظف بعد التحقّق من هويته** — وهو الضبط الصحيح أمنيًّا على أيّ حال:
-- من يربط الحساب يتحمّل مسؤولية التحقّق، ولا يُفتح ملفٌ طبيّ برسالة تصل
-- إلى رقمٍ قد يكون خاطئًا.
--
-- المبادئ الحاكمة هنا، وكلها مطبَّقة في القاعدة لا في الواجهة:
--
--   1) **المريض ليس عضوًا في المنشأة.** كل سياسات النظام مبنية على
--      `app_is_member`، فالمريض لا يرى شيئًا افتراضيًّا. ما يراه يُفتح له
--      سطرًا سطرًا بسياسات ضيّقة، لا بمنحه عضوية.
--   2) **النتيجة غير المعتمدة لا تُعرض.** تحليلٌ قيد المراجعة يصل المريض
--      فيفزعه أو يطمئنه بلا وجه حقّ — يُعرض ما اعتُمد فقط.
--   3) **المريض لا يحجز موعدًا بنفسه في التقويم**، بل يقدّم طلبًا يراجعه
--      الاستقبال. سماح المريض بالكتابة مباشرة في `appointments` يعني
--      احتلال فترات الأطباء من الخارج.
--   4) **بيانات الهوية لا تُعدَّل ذاتيًّا**: طلب تعديل يراجعه موظف. رقم
--      الهوية والاسم أساس مطابقة الملف والتأمين.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات (للموظفين — المريض لا يملك صلاحيات نظام)
-- ===========================================================================
-- ⟪PRECHECK-BEGIN⟫
-- ── تحقّق من المتطلبات السابقة ────────────────────────────────────────────
-- الهجرات تُنفَّذ بالترتيب الرقمي. لو نُفِّذ هذا الملف قبل ما يسبقه فالخطأ
-- الذي يظهر يكون غامضًا (42P01: relation ... does not exist) ولا يدلّ على
-- السبب. الكتلة التالية توقف التنفيذ فورًا برسالة تسمّي الملف الناقص.
-- لا تُغيّر شيئًا في القاعدة، وتُعاد بلا أثر.
do $zc_precheck$
declare
  v_missing text := '';
begin
  if to_regclass('public.payroll_runs') is null then
    v_missing := v_missing || E'\n  • 0100_hr_and_payroll.sql  (الموارد البشرية والرواتب)';
  end if;
  if to_regclass('public.assets') is null then
    v_missing := v_missing || E'\n  • 0101_assets_and_maintenance.sql  (الأصول والصيانة)';
  end if;
  if to_regclass('public.document_signatures') is null then
    v_missing := v_missing || E'\n  • 0102_documents_and_signatures.sql  (المستندات والتواقيع)';
  end if;
  if to_regclass('public.notification_rules') is null then
    v_missing := v_missing || E'\n  • 0103_notifications.sql  (التنبيهات الداخلية)';
  end if;
  if v_missing <> '' then
    raise exception E'⛔ لا يمكن تنفيذ 0104_patient_portal.sql — هجرات سابقة لم تُنفَّذ بعد:%\n\nنفِّذ الملفات الناقصة أولًا بالترتيب الرقمي، ثم أعد تنفيذ هذا الملف.\nتذكير: ملفات مجلد e2e/sql اختبارات ولا تُنفَّذ على قاعدة الإنتاج إطلاقًا.',
      v_missing;
  end if;
end
$zc_precheck$;
-- ⟪PRECHECK-END⟫

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('patient_portal.view', 'عرض بوابة المرضى',    'portal', 1698),
  ('portal.manage',  'ربط حسابات بوابة المرضى', 'portal', 1700),
  ('portal.requests','مراجعة طلبات المرضى',      'portal', 1702)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'patient_portal.view'),
  ('branch_manager', 'portal.manage'), ('branch_manager', 'portal.requests'),
  ('receptionist',   'patient_portal.view'), ('receptionist', 'portal.requests')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) حسابات البوابة
-- ===========================================================================
create table if not exists patient_portal_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'active'
                    check (status in ('active','suspended','revoked')),
  linked_by       uuid references auth.users(id),
  linked_at       timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users(id),
  revoke_reason   text,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- حسابٌ واحد لكل مريض، ومستخدمٌ واحد لا يمثّل مريضين في المنشأة نفسها
create unique index if not exists uq_portal_account_patient
  on patient_portal_accounts (organization_id, patient_id);
create unique index if not exists uq_portal_account_user
  on patient_portal_accounts (organization_id, user_id);

alter table patient_portal_accounts enable row level security;

-- ===========================================================================
-- 3) طلبات المواعيد وطلبات تعديل البيانات
-- ===========================================================================
create table if not exists appointment_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  patient_id      uuid not null references patients(id) on delete cascade,
  clinic_id       uuid references clinics(id),
  doctor_id       uuid references doctors(id),
  preferred_date  date,
  preferred_period text check (preferred_period in ('morning','evening','any')),
  reason          text,
  status          text not null default 'pending'
                    check (status in ('pending','approved','rejected','cancelled')),
  appointment_id  uuid references appointments(id),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_note   text,
  source          text not null default 'portal',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_appointment_requests_pending
  on appointment_requests (organization_id, status, preferred_date);

alter table appointment_requests enable row level security;

create table if not exists patient_change_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  field_key       text not null
                    check (field_key in ('phone_1','phone_2','email_1','email_2',
                                        'address','emergency_number')),
  current_value   text,
  requested_value text not null,
  status          text not null default 'pending'
                    check (status in ('pending','approved','rejected')),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);

alter table patient_change_requests enable row level security;

-- ===========================================================================
-- 4) دوال الهوية — من هو المريض صاحب هذه الجلسة؟
-- ===========================================================================
create or replace function app_portal_patient_id(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.patient_id from patient_portal_accounts a
   where a.organization_id = p_org
     and a.user_id = auth.uid()
     and a.status = 'active';
$$;

-- الاستعمال داخل السياسات: هل هذا الصفّ يخصّ المريض صاحب الجلسة؟
create or replace function app_is_portal_patient(p_org uuid, p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_patient_id is not null and exists (
    select 1 from patient_portal_accounts a
     where a.organization_id = p_org
       and a.user_id = auth.uid()
       and a.patient_id = p_patient_id
       and a.status = 'active'
  );
$$;

-- ===========================================================================
-- 5) دوال الموظفين: الربط والإلغاء
-- ===========================================================================
create or replace function app_link_patient_portal_account(
  p_patient_id uuid,
  p_email      text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_user uuid;
  v_id   uuid;
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null then raise exception 'المريض غير موجود'; end if;
  if not app_has_permission(v_org, 'portal.manage') then
    raise exception 'صلاحيتك لا تسمح بربط حسابات البوابة (portal.manage)';
  end if;

  -- **لا يُنشأ حساب من هنا ولا تُلمس كلمة مرور**: المريض يسجّل بنفسه،
  -- والموظف يربط الحساب القائم بملفه بعد التحقّق من هويته.
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'لا يوجد حساب بهذا البريد — يسجّل المريض بنفسه أولًا ثم يُربط ملفه';
  end if;

  if exists (select 1 from organization_memberships m
              where m.organization_id = v_org and m.user_id = v_user) then
    raise exception 'هذا الحساب موظف في المنشأة — لا يُربط كحساب مريض';
  end if;

  insert into patient_portal_accounts (organization_id, patient_id, user_id, linked_by)
  values (v_org, p_patient_id, v_user, auth.uid())
  on conflict (organization_id, patient_id) do update
    set user_id = excluded.user_id, status = 'active',
        linked_by = auth.uid(), linked_at = now(),
        revoked_at = null, revoked_by = null, revoke_reason = null,
        updated_at = now()
  returning id into v_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, auth.uid(), 'portal', 'add', v_id, 'ربط حساب بوابة مريض', p_email);

  return v_id;
end $$;

create or replace function app_revoke_patient_portal_access(
  p_account_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid;
begin
  select organization_id into v_org from patient_portal_accounts where id = p_account_id;
  if v_org is null then raise exception 'الحساب غير موجود'; end if;
  if not app_has_permission(v_org, 'portal.manage') then
    raise exception 'صلاحيتك لا تسمح بإلغاء حسابات البوابة (portal.manage)';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب إلغاء الوصول مطلوب';
  end if;

  update patient_portal_accounts
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = p_reason, updated_at = now()
   where id = p_account_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_org, auth.uid(), 'portal', 'update', p_account_id,
          'إلغاء وصول بوابة مريض', null, p_reason);
end $$;

-- ===========================================================================
-- 6) دوال المريض نفسه
-- ===========================================================================
create or replace function app_portal_request_appointment(
  p_org       uuid,
  p_clinic_id uuid default null,
  p_doctor_id uuid default null,
  p_date      date default null,
  p_period    text default 'any',
  p_reason    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_patient uuid; v_id uuid; v_open int;
begin
  v_patient := app_portal_patient_id(p_org);
  if v_patient is null then
    raise exception 'لا يوجد حساب بوابة نشط لهذه المنشأة';
  end if;
  if p_date is not null and p_date < current_date then
    raise exception 'لا يُطلب موعد في تاريخ ماضٍ';
  end if;

  -- **حدّ للطلبات المفتوحة**: بابٌ مفتوح للطلبات بلا حدّ يُغرق الاستقبال
  select count(*) into v_open from appointment_requests
   where organization_id = p_org and patient_id = v_patient and status = 'pending';
  if v_open >= 3 then
    raise exception 'لديك 3 طلبات مواعيد قيد المراجعة — انتظر ردّ الاستقبال';
  end if;

  insert into appointment_requests (organization_id, patient_id, clinic_id, doctor_id,
                                    preferred_date, preferred_period, reason)
  values (p_org, v_patient, p_clinic_id, p_doctor_id, p_date,
          coalesce(p_period, 'any'), p_reason)
  returning id into v_id;

  perform app_notify_event(
    p_org, 'purchase_request_pending', 'طلب موعد جديد من بوابة المريض',
    format('apptreq:%s', v_id), p_reason, 'appointment_request', v_id,
    '/appointments', null);

  return v_id;
end $$;

create or replace function app_portal_cancel_appointment(
  p_appointment_id uuid,
  p_reason         text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare a appointments%rowtype;
begin
  select * into a from appointments where id = p_appointment_id for update;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if not app_is_portal_patient(a.organization_id, a.patient_id) then
    raise exception 'هذا الموعد ليس لك';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب الإلغاء مطلوب';
  end if;
  -- الموعد المنقضي أو الذي حضره المريض لا يُلغى من البوابة
  if a.scheduled_start < now() then
    raise exception 'لا يُلغى موعد مضى وقته — اتصل بالاستقبال';
  end if;
  -- الحالات التي يُقبل الإلغاء منها فقط؛ وما بعد الوصول يُدار من الاستقبال
  if a.status not in ('new','scheduled','unconfirmed','confirmed') then
    raise exception 'حالة الموعد (%) لا تسمح بالإلغاء من البوابة', a.status;
  end if;

  update appointments
     -- **الإلغاء من المريض له حالته الخاصة**: التمييز بين إلغاء المريض
     -- وإلغاء المنشأة أساسٌ لتقارير عدم الحضور ومحاسبة الفترات الضائعة.
     set status = 'cancelled_by_patient',
         cancellation_reason = format('إلغاء من بوابة المريض: %s', p_reason),
         updated_at = now()
   where id = p_appointment_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (a.organization_id, a.branch_id, auth.uid(), 'portal', 'update',
          p_appointment_id, 'إلغاء موعد من البوابة', null, p_reason);
end $$;

create or replace function app_portal_request_change(
  p_org   uuid,
  p_field text,
  p_value text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_patient uuid; v_id uuid; v_current text;
begin
  v_patient := app_portal_patient_id(p_org);
  if v_patient is null then
    raise exception 'لا يوجد حساب بوابة نشط لهذه المنشأة';
  end if;
  if coalesce(trim(coalesce(p_value, '')), '') = '' then
    raise exception 'القيمة المطلوبة مطلوبة';
  end if;

  select case p_field
           when 'phone_1' then phone_1
           when 'phone_2' then phone_2
           when 'email_1' then email_1
           when 'email_2' then email_2
           when 'address' then address
           when 'emergency_number' then emergency_number
           else null end
    into v_current
    from patients where id = v_patient;

  insert into patient_change_requests (organization_id, patient_id, field_key,
                                       current_value, requested_value)
  values (p_org, v_patient, p_field, v_current, trim(p_value))
  returning id into v_id;

  return v_id;
end $$;

create or replace function app_portal_touch(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update patient_portal_accounts
     set last_seen_at = now(), updated_at = now()
   where organization_id = p_org and user_id = auth.uid() and status = 'active';
end $$;

-- ===========================================================================
-- 7) دوال مراجعة الطلبات (موظفون)
-- ===========================================================================
create or replace function app_approve_appointment_request(
  p_request_id uuid,
  p_start      timestamptz,
  p_end        timestamptz,
  p_doctor_id  uuid default null,
  p_clinic_id  uuid default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r appointment_requests%rowtype; v_appt uuid; v_branch uuid;
begin
  select * into r from appointment_requests where id = p_request_id for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(r.organization_id, 'portal.requests') then
    raise exception 'صلاحيتك لا تسمح بمراجعة طلبات المرضى (portal.requests)';
  end if;
  if r.status <> 'pending' then
    raise exception 'الطلب حالته % — لا يُراجع مرّتين', r.status;
  end if;
  if p_end <= p_start then
    raise exception 'نهاية الموعد يجب أن تكون بعد بدايته';
  end if;

  select branch_id into v_branch from clinics
   where id = coalesce(p_clinic_id, r.clinic_id);

  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            scheduled_start, scheduled_end, status, note, created_by)
  values (r.organization_id, v_branch, coalesce(p_clinic_id, r.clinic_id),
          coalesce(p_doctor_id, r.doctor_id), r.patient_id, p_start, p_end,
          'scheduled', coalesce(p_note, r.reason), auth.uid())
  returning id into v_appt;

  update appointment_requests
     set status = 'approved', appointment_id = v_appt, decided_by = auth.uid(),
         decided_at = now(), decision_note = p_note, updated_at = now()
   where id = p_request_id;

  return v_appt;
end $$;

create or replace function app_reject_appointment_request(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; v_status text;
begin
  select organization_id, status into v_org, v_status
    from appointment_requests where id = p_request_id for update;
  if v_org is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(v_org, 'portal.requests') then
    raise exception 'صلاحيتك لا تسمح بمراجعة طلبات المرضى (portal.requests)';
  end if;
  if v_status <> 'pending' then
    raise exception 'الطلب حالته % — لا يُراجع مرّتين', v_status;
  end if;
  -- **الرفض بلا سبب لا يفيد المريض**: يظهر له السبب في بوابته
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب الرفض مطلوب';
  end if;

  update appointment_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_reason, updated_at = now()
   where id = p_request_id;
end $$;

create or replace function app_decide_patient_change_request(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r patient_change_requests%rowtype;
begin
  select * into r from patient_change_requests where id = p_request_id for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not app_has_permission(r.organization_id, 'portal.requests') then
    raise exception 'صلاحيتك لا تسمح بمراجعة طلبات المرضى (portal.requests)';
  end if;
  if r.status <> 'pending' then
    raise exception 'الطلب حالته % — لا يُراجع مرّتين', r.status;
  end if;
  if not p_approve and coalesce(trim(coalesce(p_note, '')), '') = '' then
    raise exception 'سبب الرفض مطلوب';
  end if;

  if p_approve then
    -- التعديل يُطبَّق بعد المراجعة، لا قبلها
    if r.field_key = 'phone_1' then
      update patients set phone_1 = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'phone_2' then
      update patients set phone_2 = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'email_1' then
      update patients set email_1 = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'email_2' then
      update patients set email_2 = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'address' then
      update patients set address = r.requested_value, updated_at = now() where id = r.patient_id;
    elsif r.field_key = 'emergency_number' then
      update patients set emergency_number = r.requested_value, updated_at = now()
       where id = r.patient_id;
    end if;
  end if;

  update patient_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_request_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (r.organization_id, auth.uid(), 'portal', 'update', r.patient_id,
          'مراجعة طلب تعديل بيانات',
          format('%s ← %s (%s)', r.field_key, r.requested_value,
                 case when p_approve then 'اعتُمد' else 'رُفض' end));
end $$;

-- ===========================================================================
-- 8) سياسات البوابة — ضيّقة، صفًّا صفًّا
--    كل سياسة هنا تُضاف إلى سياسات الأعضاء القائمة ولا تمسّها.
-- ===========================================================================
do $$
begin
  -- حساب البوابة: الموظف يديره، والمريض يرى حسابه هو
  if not exists (select 1 from pg_policies where tablename = 'patient_portal_accounts'
                  and policyname = 'portal_accounts_staff') then
    create policy portal_accounts_staff on patient_portal_accounts for all to authenticated
      using (app_is_member(organization_id)) with check (app_is_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_portal_accounts'
                  and policyname = 'portal_accounts_own') then
    create policy portal_accounts_own on patient_portal_accounts for select to authenticated
      using (user_id = auth.uid());
  end if;

  -- ملفّه هو، لا غير
  if not exists (select 1 from pg_policies where tablename = 'patients'
                  and policyname = 'patients_portal_self') then
    create policy patients_portal_self on patients for select to authenticated
      using (app_is_portal_patient(organization_id, id));
  end if;

  -- مواعيده
  if not exists (select 1 from pg_policies where tablename = 'appointments'
                  and policyname = 'appointments_portal_self') then
    create policy appointments_portal_self on appointments for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;

  -- زياراته
  if not exists (select 1 from pg_policies where tablename = 'patient_visits'
                  and policyname = 'visits_portal_self') then
    create policy visits_portal_self on patient_visits for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;

  -- **نتائج المختبر المعتمدة فقط**
  if not exists (select 1 from pg_policies where tablename = 'lab_orders'
                  and policyname = 'lab_orders_portal_self') then
    create policy lab_orders_portal_self on lab_orders for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id)
             and status in ('approved','delivered'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lab_order_items'
                  and policyname = 'lab_items_portal_self') then
    create policy lab_items_portal_self on lab_order_items for select to authenticated
      using (exists (select 1 from lab_orders o
                      where o.id = lab_order_id
                        and app_is_portal_patient(o.organization_id, o.patient_id)
                        and o.status in ('approved','delivered')));
  end if;

  -- **تقارير الأشعة المعتمدة فقط**
  if not exists (select 1 from pg_policies where tablename = 'radiology_orders'
                  and policyname = 'radiology_portal_self') then
    create policy radiology_portal_self on radiology_orders for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id)
             and status in ('verified','delivered'));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'radiology_order_items'
                  and policyname = 'radiology_items_portal_self') then
    create policy radiology_items_portal_self on radiology_order_items for select to authenticated
      using (exists (select 1 from radiology_orders o
                      where o.id = radiology_order_id
                        and app_is_portal_patient(o.organization_id, o.patient_id)
                        and o.status in ('verified','delivered')));
  end if;

  -- وصفاته
  if not exists (select 1 from pg_policies where tablename = 'prescriptions'
                  and policyname = 'prescriptions_portal_self') then
    create policy prescriptions_portal_self on prescriptions for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prescription_items'
                  and policyname = 'prescription_items_portal_self') then
    create policy prescription_items_portal_self on prescription_items for select to authenticated
      using (exists (select 1 from prescriptions p
                      where p.id = prescription_id
                        and app_is_portal_patient(p.organization_id, p.patient_id)));
  end if;

  -- فواتيره
  if not exists (select 1 from pg_policies where tablename = 'sales_invoices'
                  and policyname = 'invoices_portal_self') then
    create policy invoices_portal_self on sales_invoices for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sales_invoice_items'
                  and policyname = 'invoice_items_portal_self') then
    create policy invoice_items_portal_self on sales_invoice_items for select to authenticated
      using (exists (select 1 from sales_invoices i
                      where i.id = invoice_id
                        and app_is_portal_patient(i.organization_id, i.patient_id)));
  end if;

  -- مستنداته غير المؤرشفة
  if not exists (select 1 from pg_policies where tablename = 'patient_documents'
                  and policyname = 'documents_portal_self') then
    create policy documents_portal_self on patient_documents for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id)
             and not coalesce(is_archived, false));
  end if;

  -- طلباته
  if not exists (select 1 from pg_policies where tablename = 'appointment_requests'
                  and policyname = 'appt_requests_staff') then
    create policy appt_requests_staff on appointment_requests for all to authenticated
      using (app_is_member(organization_id)) with check (app_is_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'appointment_requests'
                  and policyname = 'appt_requests_portal_self') then
    create policy appt_requests_portal_self on appointment_requests for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_change_requests'
                  and policyname = 'change_requests_staff') then
    create policy change_requests_staff on patient_change_requests for all to authenticated
      using (app_is_member(organization_id)) with check (app_is_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'patient_change_requests'
                  and policyname = 'change_requests_portal_self') then
    create policy change_requests_portal_self on patient_change_requests for select to authenticated
      using (app_is_portal_patient(organization_id, patient_id));
  end if;
end $$;

-- ===========================================================================
-- 9) مناظير البوابة — security_invoker فتسري عليها السياسات أعلاه
-- ===========================================================================
drop view if exists v_portal_appointments;
create view v_portal_appointments
with (security_invoker = on) as
select
  a.id, a.organization_id, a.branch_id, a.patient_id,
  a.scheduled_start, a.scheduled_end, a.status,
  c.name    as clinic_name,
  d.name_ar as doctor_name,
  (a.scheduled_start > now()) as is_upcoming,
  a.scheduled_start::date as report_date
from appointments a
left join clinics c on c.id = a.clinic_id
left join doctors d on d.id = a.doctor_id;

drop view if exists v_portal_results;
create view v_portal_results
with (security_invoker = on) as
select
  o.id, o.organization_id, o.patient_id, 'lab'::text as result_kind,
  t.name_ar        as test_name,
  i.result_value,
  i.unit_override  as unit,
  i.reference_text,
  i.is_abnormal,
  o.status,
  coalesce(i.entered_at, o.created_at) as resulted_at,
  coalesce(i.entered_at, o.created_at)::date as report_date
from lab_orders o
join lab_order_items i on i.lab_order_id = o.id
left join lab_tests t on t.id = i.lab_test_id
union all
select
  r.id, r.organization_id, r.patient_id, 'radiology',
  ex.name_ar,
  -- **الانطباع المعتمد فقط**: السياسة تمنع ظهور الطلب قبل اعتماده أصلًا
  ri.impression,
  null, null, null, r.status,
  coalesce(r.reported_at, r.ordered_at),
  coalesce(r.reported_at, r.ordered_at)::date
from radiology_orders r
left join radiology_order_items ri on ri.radiology_order_id = r.id
left join radiology_exams ex on ex.id = ri.radiology_exam_id;

comment on view v_portal_results is
  'نتائج المريض المعتمدة فقط — السياسات تمنع ظهور ما لم يُعتمد بعد.';

drop view if exists v_portal_invoices;
create view v_portal_invoices
with (security_invoker = on) as
select
  i.id, i.organization_id, i.branch_id, i.patient_id,
  i.invoice_number, i.invoice_type, i.status,
  i.net_amount, i.paid_amount, i.remaining_amount,
  i.created_at,
  i.created_at::date as report_date
from sales_invoices i;

drop view if exists v_portal_documents;
create view v_portal_documents
with (security_invoker = on) as
select
  d.id, d.organization_id, d.patient_id, d.file_name, d.storage_path,
  d.category, d.is_consent, d.signed_at, d.expires_at, d.created_at,
  d.created_at::date as report_date
from patient_documents d
where not coalesce(d.is_archived, false);

-- منظور الموظفين: الطلبات المعلّقة
drop view if exists v_pending_patient_requests;
create view v_pending_patient_requests
with (security_invoker = on) as
select
  r.id, r.organization_id, r.branch_id, 'appointment'::text as request_kind,
  r.patient_id, p.name_ar as patient_name, p.file_number,
  coalesce(r.reason, '')      as details,
  r.preferred_date::text      as requested_value,
  r.status, r.created_at, r.created_at::date as report_date
from appointment_requests r
join patients p on p.id = r.patient_id
where r.status = 'pending'
union all
select
  c.id, c.organization_id, null::uuid, 'contact_change',
  c.patient_id, p.name_ar, p.file_number,
  c.field_key, c.requested_value, c.status, c.created_at, c.created_at::date
from patient_change_requests c
join patients p on p.id = c.patient_id
where c.status = 'pending';

grant select on v_portal_appointments, v_portal_results, v_portal_invoices,
                v_portal_documents, v_pending_patient_requests to authenticated;

-- ===========================================================================
-- 10) الميزة وحجب الدوال
-- ===========================================================================
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'patient_portal', 'بوابة المريض', 'Patient Portal', 'الاستقبال والمواعيد', false, 46
where not exists (select 1 from feature_catalog where feature_key = 'patient_portal');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'patient_portal', true from organizations o
on conflict (organization_id, feature_key) do nothing;

do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_after_organization_created';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is not null and position('''patient_portal''' in v_src) = 0 then
    v_new := replace(v_src, '''audit_log'',''settings''',
                            '''audit_log'',''settings'',''patient_portal''');
    if v_new = v_src then
      raise exception 'تعذّر إدراج ميزة بوابة المريض في مزايا المنشأة الافتراضية';
    end if;
    execute v_new;
  end if;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname in ('app_portal_patient_id','app_is_portal_patient',
                         'app_link_patient_portal_account','app_revoke_patient_portal_access',
                         'app_portal_request_appointment','app_portal_cancel_appointment',
                         'app_portal_request_change','app_portal_touch',
                         'app_approve_appointment_request','app_reject_appointment_request',
                         'app_decide_patient_change_request')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_portal_patient_id','app_is_portal_patient',
                             'app_link_patient_portal_account','app_portal_request_appointment',
                             'app_portal_cancel_appointment','app_approve_appointment_request']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة البوابة % غير موجودة', v_v;
    end if;
  end loop;

  -- **المريض لا يكتب في التقويم**: لا سياسة إدراج/تعديل للبوابة على المواعيد
  if exists (
    select 1 from pg_policies
     where tablename = 'appointments' and cmd in ('INSERT','UPDATE','ALL')
       and qual like '%app_is_portal_patient%')
  then
    raise exception 'المريض يستطيع الكتابة في جدول المواعيد — ممنوع';
  end if;

  -- النتيجة غير المعتمدة محجوبة بالسياسة نفسها
  if not exists (
    select 1 from pg_policies
     where tablename = 'lab_orders' and policyname = 'lab_orders_portal_self'
       and qual like '%approved%')
  then
    raise exception 'سياسة المختبر لا تقصر العرض على النتائج المعتمدة';
  end if;

  foreach v_v in array array['v_portal_appointments','v_portal_results','v_portal_invoices',
                             'v_portal_documents','v_pending_patient_requests']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v
         and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%')
    then
      raise exception 'منظور البوابة % بلا security_invoker — يتجاوز السياسات', v_v;
    end if;
  end loop;
end $$;
