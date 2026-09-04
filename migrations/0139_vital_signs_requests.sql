-- ============================================================================
-- 0139 — طلب المؤشرات الحيوية: من الاستقبال أو الطبيب، ينفّذه المختبر
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   المؤشرات الحيوية اليوم تُكتب في مكان واحد فقط: داخل الزيارة الطبية
--   (`app_save_visit`)، أو بإدخالٍ مباشر من ملف المريض يكتب في
--   `patient_vital_signs` **بلا أيّ دالّة وسيطة** — فلا فحص صلاحية، ولا
--   حساب لكتلة الجسم، ولا أثر يقول من قاس ومتى.
--
--   والأهمّ: **لا سبيل لطلبها**. المريض يصل الاستقبال فيُرسَل إلى الطبيب بلا
--   قياس، فيطلب الطبيب القياس شفويًّا ويخرج المريض ويعود. لا طابور، ولا
--   أثر، ولا شيء يصل الطبيب حين يُقاس.
--
-- ما يضيفه هذا الملف:
--
--   • `vital_sign_requests` — طلب قياس له طرفان: من طلبه (استقبال أو طبيب)
--     ولمن يُرسَل الناتج (الطبيب المرتبط بالمريض). ينفّذه المختبر.
--   • نوعان: **عام** — الستة المعتادة (الضغط، النبض، الحرارة، التنفس،
--     الوزن، الطول)؛ و**خاص** — يختار الطالب ما يريد. السكر ليس في العام
--     لأنه يحتاج وخزة إصبع، وإدراجه افتراضيًّا يعني وخزًا بلا داعٍ.
--   • `app_request_vital_signs` — الطلب.
--   • `app_record_vital_signs` — التسجيل: يكتب القياس، ويحسب كتلة الجسم،
--     ويُغلق الطلب، ويُخطر الطبيب — عملية واحدة ذرّية. وتعمل أيضًا بلا طلب
--     (قياس الاستقبال عند الدخول).
--   • عروض: طابور القياسات، وما وصل الطبيب.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.** الإخطار داخليّ فقط.
-- ============================================================================

do $zc_pre$
begin
  if to_regclass('public.patient_vital_signs') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0139: `patient_vital_signs` غير موجود — شغّل هجرات الزيارة أولًا.';
  end if;
  if to_regprocedure('public.app_notify_event(uuid,text,text,text,text,text,uuid,text,uuid)') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0139: `app_notify_event` غير موجودة — شغّل 0103_notifications.sql أولًا.';
  end if;
  if to_regclass('public.staff_requests') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0139: شغّل 0138_radiology_relay_and_staff_requests.sql أولًا.';
  end if;
end
$zc_pre$;

-- ===========================================================================
-- 1) الصلاحيات والميزة
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
values
  ('vitals.view',    'عرض المؤشرات الحيوية',   'vitals', 700),
  ('vitals.request', 'طلب قياس مؤشرات حيوية',  'vitals', 701),
  ('vitals.record',  'تسجيل قياس مؤشرات حيوية','vitals', 702)
on conflict (permission_key) do nothing;

-- من يقيس فعلًا: المختبر والتمريض والاستقبال. ومن يطلب: الاستقبال والطبيب
-- والتمريض. الطبيب يرى ولا يقيس في المسار المعتاد، لكن منعُه من التسجيل
-- يوقف العمل حين يقيس بنفسه في عيادته — فله الثلاثة.
insert into role_default_permissions (role_key, permission_key)
values
  ('owner','vitals.view'), ('organization_admin','vitals.view'),
  ('branch_manager','vitals.view'), ('doctor','vitals.view'),
  ('nurse','vitals.view'), ('receptionist','vitals.view'),
  ('lab_technician','vitals.view'),

  ('owner','vitals.request'), ('organization_admin','vitals.request'),
  ('branch_manager','vitals.request'), ('doctor','vitals.request'),
  ('nurse','vitals.request'), ('receptionist','vitals.request'),

  ('owner','vitals.record'), ('organization_admin','vitals.record'),
  ('branch_manager','vitals.record'), ('doctor','vitals.record'),
  ('nurse','vitals.record'), ('receptionist','vitals.record'),
  ('lab_technician','vitals.record')
on conflict do nothing;

insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'vitals', 'المؤشرات الحيوية', 'Vital Signs', 'الكتالوج الطبي', false, 95
where not exists (select 1 from feature_catalog where feature_key = 'vitals');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'vitals', true from organizations o
on conflict (organization_id, feature_key) do nothing;

-- ===========================================================================
-- 2) جدول الطلبات
-- ===========================================================================
create table if not exists vital_sign_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  patient_id       uuid not null references patients(id),
  -- الطبيب الذي يصله الناتج. قد يكون فارغًا حين يقيس الاستقبال بلا وجهة.
  doctor_id        uuid references doctors(id),
  visit_id         uuid references patient_visits(id),
  request_kind     text not null default 'general'
                     check (request_kind in ('general','custom')),
  -- قائمة مغلقة: أيّ اسمٍ خارجها يعني قياسًا لا حقل له في القاعدة.
  measures         text[] not null default '{}',
  priority         text not null default 'routine'
                     check (priority in ('routine','urgent')),
  note             text,
  status           text not null default 'pending'
                     check (status in ('pending','done','cancelled')),
  requested_by     uuid references auth.users(id),
  requested_at     timestamptz not null default now(),
  recorded_by      uuid references auth.users(id),
  recorded_at      timestamptz,
  vital_sign_id    uuid references patient_vital_signs(id),
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table vital_sign_requests is
  'طلب قياس المؤشرات الحيوية. يطلبه الاستقبال أو الطبيب، وينفّذه المختبر أو التمريض، وينتهي بصفٍّ في patient_vital_signs يُخطَر به الطبيب.';
comment on column vital_sign_requests.measures is
  'القياسات المطلوبة. العام = الستة المعتادة؛ الخاص = اختيار الطالب. السكر لا يدخل العام لأنه يحتاج وخزة إصبع.';

create index if not exists idx_vital_requests_open
  on vital_sign_requests (organization_id, status, requested_at);
create index if not exists idx_vital_requests_patient
  on vital_sign_requests (patient_id, requested_at desc);
create index if not exists idx_vital_requests_doctor
  on vital_sign_requests (doctor_id, status);

alter table vital_sign_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'vital_sign_requests'
                    and policyname = 'vital_sign_requests_members') then
    create policy vital_sign_requests_members on vital_sign_requests
      for all using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;
end $$;

-- المفردات المغلقة للقياسات، في مكان واحد لا يتكرّر.
create or replace function app_vital_measure_keys()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array['blood_pressure','heart_rate','temperature',
               'respiratory_rate','weight','height','glucose'];
$$;

create or replace function app_vital_general_measures()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  -- الستة المعتادة. السكر خارجها عمدًا.
  select array['blood_pressure','heart_rate','temperature',
               'respiratory_rate','weight','height'];
$$;

-- ===========================================================================
-- 3) الطلب
-- ===========================================================================
create or replace function app_request_vital_signs(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_doctor_id       uuid default null,
  p_request_kind    text default 'general',
  p_measures        text[] default null,
  p_priority        text default 'routine',
  p_note            text default null,
  p_visit_id        uuid default null,
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_measures text[];
  v_bad      text;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'vitals.request') then
    raise exception 'صلاحيتك لا تسمح بطلب المؤشرات الحيوية (vitals.request)';
  end if;
  if coalesce(p_request_kind,'general') not in ('general','custom') then
    raise exception 'نوع الطلب غير صالح';
  end if;
  if coalesce(p_priority,'routine') not in ('routine','urgent') then
    raise exception 'أولوية غير صالحة';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;
  if p_doctor_id is not null and not exists (
       select 1 from doctors where id = p_doctor_id
        and organization_id = p_organization_id) then
    raise exception 'الطبيب غير موجود في هذه المنشأة';
  end if;

  if coalesce(p_request_kind,'general') = 'general' then
    v_measures := app_vital_general_measures();
  else
    v_measures := coalesce(p_measures, '{}');
    if array_length(v_measures, 1) is null then
      raise exception 'الطلب الخاص يحتاج قياسًا واحدًا على الأقل';
    end if;
    -- اسمٌ خارج القائمة يعني حقلًا لا وجود له، والقياس يُطلب ولا يُسجَّل أبدًا.
    select m into v_bad from unnest(v_measures) m
     where m <> all(app_vital_measure_keys()) limit 1;
    if v_bad is not null then
      raise exception 'قياس غير معروف: %', v_bad;
    end if;
  end if;

  -- طلبٌ معلّق لنفس المريض قائم؟ لا يُكرَّر: طلبان معلّقان يعنيان قياسين
  -- ويحتار المختبر أيّهما يُغلق.
  select id into v_id from vital_sign_requests
   where organization_id = p_organization_id
     and patient_id = p_patient_id
     and status = 'pending'
   limit 1;
  if v_id is not null then
    raise exception 'يوجد طلب قياس معلّق لهذا المريض بالفعل';
  end if;

  insert into vital_sign_requests (organization_id, branch_id, patient_id,
                                   doctor_id, visit_id, request_kind, measures,
                                   priority, note, requested_by)
  values (p_organization_id, p_branch_id, p_patient_id, p_doctor_id, p_visit_id,
          coalesce(p_request_kind,'general'), v_measures,
          coalesce(p_priority,'routine'),
          nullif(btrim(coalesce(p_note,'')), ''), auth.uid())
  returning id into v_id;

  perform app_notify_event(
    p_organization_id, 'vitals_requested', 'طلب قياس مؤشرات حيوية',
    'vitals_req:' || v_id::text,
    coalesce((select name_ar from patients where id = p_patient_id), 'مريض')
      || ' — ' || array_length(v_measures, 1)::text || ' قياس'
      || case when coalesce(p_priority,'routine') = 'urgent' then ' (عاجل)' else '' end,
    'vital_sign_request', v_id, '/vitals', p_branch_id);

  return v_id;
end;
$$;

-- ===========================================================================
-- 4) التسجيل — قياسٌ واحد ذرّي
-- ===========================================================================
-- تعمل في الحالتين: استجابةً لطلب (`p_request_id`)، أو بلا طلب حين يقيس
-- الاستقبال عند الدخول. وفي الحالتين تُحسب كتلة الجسم ويُخطَر الطبيب.
--
-- كتلة الجسم **لا تُحسب هنا ولا في الواجهة**: `patient_vital_signs.bmi` عمود
-- مُولَّد (generated always) في القاعدة منذ إنشائه، يحسبها من الطول والوزن.
-- إعادة حسابها هنا تكرارٌ لصيغةٍ واحدة في موضعين، والقاعدة ترفض الكتابة فيه
-- أصلًا. فالصيغة تبقى في مكان واحد، ويأخذها كل مسار إدخال بلا استثناء.
create or replace function app_record_vital_signs(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_values          jsonb,
  p_request_id      uuid default null,
  p_visit_id        uuid default null,
  p_doctor_id       uuid default null,
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_req      vital_sign_requests%rowtype;
  v_sys      numeric := nullif(p_values->>'blood_pressure_systolic','')::numeric;
  v_dia      numeric := nullif(p_values->>'blood_pressure_diastolic','')::numeric;
  v_hr       numeric := nullif(p_values->>'heart_rate','')::numeric;
  v_temp     numeric := nullif(p_values->>'temperature_celsius','')::numeric;
  v_glucose  numeric := nullif(p_values->>'glucose_level','')::numeric;
  v_height   numeric := nullif(p_values->>'height_cm','')::numeric;
  v_weight   numeric := nullif(p_values->>'weight_kg','')::numeric;
  v_resp     numeric := nullif(p_values->>'respiratory_rate','')::numeric;
  v_doctor   uuid := p_doctor_id;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'vitals.record') then
    raise exception 'صلاحيتك لا تسمح بتسجيل المؤشرات الحيوية (vitals.record)';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  -- قياسٌ فارغ لا يُسجَّل: صفٌّ بلا قيمة واحدة يملأ الجدول ويُوهم بأن
  -- المريض قِيس.
  if coalesce(v_sys, v_dia, v_hr, v_temp, v_glucose, v_height, v_weight, v_resp) is null then
    raise exception 'أدخل قيمة واحدة على الأقل';
  end if;

  -- حدود فسيولوجية عريضة: ترفض الخطأ الكتابيّ (ضغط 1200) ولا ترفض الحالة
  -- الحرجة الحقيقية.
  if v_sys is not null and (v_sys < 40 or v_sys > 300) then
    raise exception 'الضغط الانقباضي خارج المدى المعقول (40–300)';
  end if;
  if v_dia is not null and (v_dia < 20 or v_dia > 200) then
    raise exception 'الضغط الانبساطي خارج المدى المعقول (20–200)';
  end if;
  if v_sys is not null and v_dia is not null and v_dia >= v_sys then
    raise exception 'الضغط الانبساطي لا يكون مساويًا أو أعلى من الانقباضي';
  end if;
  if v_hr is not null and (v_hr < 20 or v_hr > 250) then
    raise exception 'النبض خارج المدى المعقول (20–250)';
  end if;
  if v_temp is not null and (v_temp < 30 or v_temp > 45) then
    raise exception 'الحرارة خارج المدى المعقول (30–45)';
  end if;
  if v_resp is not null and (v_resp < 4 or v_resp > 80) then
    raise exception 'معدّل التنفس خارج المدى المعقول (4–80)';
  end if;
  if v_height is not null and (v_height < 30 or v_height > 250) then
    raise exception 'الطول خارج المدى المعقول (30–250 سم)';
  end if;
  if v_weight is not null and (v_weight <= 0 or v_weight > 400) then
    raise exception 'الوزن خارج المدى المعقول (0–400 كغ)';
  end if;
  if v_glucose is not null and (v_glucose < 10 or v_glucose > 900) then
    raise exception 'السكر خارج المدى المعقول (10–900)';
  end if;

  if p_request_id is not null then
    select * into v_req from vital_sign_requests
     where id = p_request_id and organization_id = p_organization_id;
    if v_req.id is null then
      raise exception 'الطلب غير موجود في هذه المنشأة';
    end if;
    if v_req.status <> 'pending' then
      raise exception 'الطلب مُغلق سلفًا (%)', v_req.status;
    end if;
    if v_req.patient_id <> p_patient_id then
      raise exception 'الطلب لمريضٍ آخر';
    end if;
    v_doctor := coalesce(v_doctor, v_req.doctor_id);
  end if;

  insert into patient_vital_signs (organization_id, patient_id, visit_id,
                                   recorded_at, heart_rate,
                                   blood_pressure_systolic, blood_pressure_diastolic,
                                   temperature_celsius, glucose_level,
                                   height_cm, weight_kg, respiratory_rate,
                                   created_by)
  values (p_organization_id, p_patient_id, coalesce(p_visit_id, v_req.visit_id),
          now(), v_hr, v_sys, v_dia, v_temp, v_glucose,
          v_height, v_weight, v_resp, auth.uid())
  returning id into v_id;

  if v_req.id is not null then
    update vital_sign_requests
       set status = 'done', recorded_by = auth.uid(), recorded_at = now(),
           vital_sign_id = v_id, updated_at = now()
     where id = v_req.id;
  end if;

  -- الطبيب يُخطَر فقط حين يكون هناك طبيب: إخطارٌ بلا وجهة ضجيجٌ للجميع.
  if v_doctor is not null then
    perform app_notify_event(
      p_organization_id, 'vitals_ready', 'مؤشرات حيوية جاهزة',
      'vitals_ready:' || v_id::text,
      coalesce((select name_ar from patients where id = p_patient_id), 'مريض')
        || coalesce(' — ضغط ' || v_sys::text || '/' || v_dia::text, '')
        || coalesce(' — نبض ' || v_hr::text, '')
        || coalesce(' — حرارة ' || v_temp::text, ''),
      'patient_vital_signs', v_id, '/doctor-workspace',
      coalesce(p_branch_id, v_req.branch_id));
  end if;

  return v_id;
end;
$$;

create or replace function app_cancel_vital_request(
  p_request_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_cur text;
begin
  select organization_id, status into v_org, v_cur
    from vital_sign_requests where id = p_request_id;
  if v_org is null then
    raise exception 'الطلب غير موجود';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(v_org, 'vitals.request') then
    raise exception 'صلاحيتك لا تسمح بإلغاء الطلب (vitals.request)';
  end if;
  if v_cur <> 'pending' then
    raise exception 'الطلب مُغلق سلفًا (%)', v_cur;
  end if;

  update vital_sign_requests
     set status = 'cancelled',
         cancel_reason = nullif(btrim(coalesce(p_reason,'')), ''),
         updated_at = now()
   where id = p_request_id;
end;
$$;

do $$
declare v_sig regprocedure;
begin
  for v_sig in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('app_request_vital_signs','app_record_vital_signs',
                         'app_cancel_vital_request','app_vital_measure_keys',
                         'app_vital_general_measures')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

-- ===========================================================================
-- 5) قواعد التنبيه
-- ===========================================================================
create or replace function app_seed_vitals_rules(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer := 0;
begin
  insert into notification_rules (organization_id, event_key, name_ar, category,
                                  severity, target_permission, channel)
  select p_org, v.k, v.n, v.c, v.s, v.p, 'internal'
  from (values
    ('vitals_requested', 'طلب قياس مؤشرات حيوية', 'clinical', 'info', 'vitals.record'),
    ('vitals_ready',     'مؤشرات حيوية جاهزة',    'clinical', 'info', 'vitals.view')
  ) as v(k, n, c, s, p)
  where not exists (select 1 from notification_rules r
                     where r.organization_id = p_org and r.event_key = v.k);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

do $zc_hook$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = 'app_seed_notification_rules';
  v_src := replace(v_src, chr(13), '');
  if v_src is null then
    raise exception 'app_seed_notification_rules غير موجودة';
  end if;
  if position('app_seed_vitals_rules' in v_src) > 0 then
    return;
  end if;
  v_new := replace(v_src,
    E'  return v_n;',
    E'  v_n := v_n + app_seed_vitals_rules(p_org);\n  return v_n;');
  if v_new = v_src then
    raise exception 'تعذّر ربط قواعد المؤشرات الحيوية ببذر المنشآت';
  end if;
  execute v_new;
end
$zc_hook$;

do $$
declare r record;
begin
  for r in select id from organizations loop
    perform app_seed_vitals_rules(r.id);
  end loop;
end $$;

-- ===========================================================================
-- 6) العروض
-- ===========================================================================

-- طابور القياس: ما ينتظر التنفيذ.
drop view if exists v_vital_sign_queue;
create view v_vital_sign_queue
with (security_invoker = on) as
select r.id            as request_id,
       r.organization_id,
       r.branch_id,
       r.patient_id,
       p.name_ar       as patient_name,
       p.id_number     as patient_id_number,
       p.phone_1       as patient_phone,
       p.birth_date,
       r.doctor_id,
       d.name_ar       as doctor_name,
       r.request_kind,
       r.measures,
       r.priority,
       r.note,
       r.status,
       r.requested_at,
       r.requested_by,
       r.visit_id
  from vital_sign_requests r
  join patients p on p.id = r.patient_id
  left join doctors d on d.id = r.doctor_id
 where r.status = 'pending';

comment on view v_vital_sign_queue is
  'طلبات القياس المعلّقة — ما ينتظر المختبر أو التمريض.';

-- قياسات المريض بترتيبها، مع من سجّلها ومن أيّ طلب.
drop view if exists v_patient_vitals;
create view v_patient_vitals
with (security_invoker = on) as
select v.id,
       v.organization_id,
       v.patient_id,
       v.visit_id,
       v.recorded_at,
       v.blood_pressure_systolic,
       v.blood_pressure_diastolic,
       v.heart_rate,
       v.temperature_celsius,
       v.respiratory_rate,
       v.glucose_level,
       v.height_cm,
       v.weight_kg,
       v.bmi,
       v.created_by,
       r.id            as request_id,
       r.request_kind,
       r.doctor_id,
       d.name_ar       as doctor_name,
       case when r.id is not null then 'طلب'
            when v.visit_id is not null then 'زيارة'
            else 'مباشر' end as source_label
  from patient_vital_signs v
  left join vital_sign_requests r on r.vital_sign_id = v.id
  left join doctors d on d.id = r.doctor_id;

comment on view v_patient_vitals is
  'قياسات المريض ومصدر كل قياس: طلب، أو زيارة، أو تسجيل مباشر عند الدخول.';

-- ما وصل الطبيب من قياسات — نظير صندوق الأشعة.
drop view if exists v_doctor_vitals_inbox;
create view v_doctor_vitals_inbox
with (security_invoker = on) as
select v.id,
       v.organization_id,
       r.branch_id,
       r.doctor_id,
       v.patient_id,
       p.name_ar     as patient_name,
       p.id_number   as patient_id_number,
       v.recorded_at,
       v.blood_pressure_systolic,
       v.blood_pressure_diastolic,
       v.heart_rate,
       v.temperature_celsius,
       v.respiratory_rate,
       v.glucose_level,
       v.weight_kg,
       v.height_cm,
       v.bmi,
       r.request_kind,
       r.note        as request_note
  from vital_sign_requests r
  join patient_vital_signs v on v.id = r.vital_sign_id
  join patients p on p.id = v.patient_id
 where r.status = 'done' and r.doctor_id is not null;

comment on view v_doctor_vitals_inbox is
  'القياسات التي نُفِّذت استجابةً لطلبٍ موجَّه لطبيب — ما يصل لوحته.';

-- ===========================================================================
-- 7) تحقّق فوريّ
-- ===========================================================================
do $zc_verify$
declare v_n int;
begin
  if to_regprocedure('public.app_request_vital_signs(uuid,uuid,uuid,text,text[],text,text,uuid,uuid)') is null
     or to_regprocedure('public.app_record_vital_signs(uuid,uuid,jsonb,uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.app_cancel_vital_request(uuid,text)') is null then
    raise exception 'دالّة واحدة أو أكثر لم تُنشأ بالتوقيع المتوقَّع';
  end if;

  -- الطلب العام ستة قياسات بالضبط، والسكر ليس فيها.
  select array_length(app_vital_general_measures(), 1) into v_n;
  if v_n <> 6 then
    raise exception 'الطلب العام % قياسًا لا 6', v_n;
  end if;
  if 'glucose' = any(app_vital_general_measures()) then
    raise exception 'السكر أُدرج في الطلب العام — يحتاج وخزة إصبع';
  end if;

  if exists (select 1 from organizations o
              where not exists (select 1 from notification_rules r
                                 where r.organization_id = o.id
                                   and r.event_key = 'vitals_ready')) then
    raise exception 'منشأة بلا قاعدة تنبيه للمؤشرات الجاهزة';
  end if;
  if pg_get_functiondef('public.app_seed_notification_rules(uuid)'::regprocedure)
       not like '%app_seed_vitals_rules%' then
    raise exception 'قواعد المؤشرات غير مربوطة ببذر المنشآت الجديدة';
  end if;

  if not exists (select 1 from feature_catalog where feature_key = 'vitals')
     or exists (select 1 from organizations o
                 where not exists (select 1 from organization_features f
                                    where f.organization_id = o.id
                                      and f.feature_key = 'vitals')) then
    raise exception 'ميزة vitals غير مسجَّلة أو غير مفعَّلة لمنشأة';
  end if;
end
$zc_verify$;
