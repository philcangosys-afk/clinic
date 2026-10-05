-- ============================================================================
-- 0226_website_booking_requests.sql — موقع الحجز الإلكتروني
-- ============================================================================
-- طلب المالك (05/10/2026):
--   • الاسم والجوال إجباريان، ولا بريد. الخدمة نصٌّ حرّ إجباري. لا ملاحظة.
--     طريقة الدفع مخفيّة حاليًا.
--   • «عند ضغط العيادة لا تظهر قائمة العيادات»: الفهرس (0132) كان يشترط
--     خدماتٍ «أسنان» مربوطة بالعيادة (`default_clinic_id`) وأطباء موسومين
--     بملاحظة تجريبية («الفريق الطبي الفعلي للمركز») — وبعد استبدال الكتالوج
--     واستيراد الأطباء الحقيقيين لم يبقَ ما يطابق، فخرجت القوائم فارغة.
--     الآن: العيادة النشطة التي فيها طبيبٌ متاح للحجز، وأطباؤها بتخصّصهم.
--   • الطبيب اختياري («أي طبيب متاح»)، والتاريخ والوقت من دوام الطبيب (أو
--     أطباء العيادة) — `app_public_doctor_slots` (0135) صار يعود فارغًا للزائر
--     منذ 0174 لأن `app_doctor_available_slots` يشترط عضوية المنشأة.
--   • **الحجز طلبٌ لا موعد ولا فاتورة:** كان `app_public_create_booking` (0134)
--     يُنشئ ملفّ مريض وموعدًا و**فاتورة ضريبية صادرة** لكلّ حجز من الموقع —
--     تُبلَّغ ZATCA ولو لم يحضر أحد. الآن يُسجَّل الحجز في
--     `appointment_requests` (الجدول القائم لطلبات المواعيد) بمصدر 'website'
--     ورقم حجزٍ متسلسل، بانتظار الاستقبال: «فتح ملف» من بيانات الحاجز (أو ربط
--     ملفٍّ موجود)، ثم «تأكيد» يُنشئ الموعد مؤكَّدًا، أو «إلغاء» بسبب.
--     يُحذف التوقيع القديم فلا يبقى طريقٌ من الموقع إلى الفواتير.
--   • تنبيهٌ للاستقبال بكلّ حجزٍ جديد (LiveNotifier).
--   • التواصل والعنوان من إعلان المجمع: 0540862125، طريق الملك خالد — مقابل
--     مغسلة الجبر.
--
-- لا يمسّ الفواتير ولا ZATCA. معاملة واحدة، القفل أوّلًا، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';
lock table public.appointment_requests in access exclusive mode;

-- ── ١) طلب الموعد يقبل حاجزًا بلا ملفّ (من الموقع وحده) ────────────────────
alter table public.appointment_requests alter column patient_id drop not null;
alter table public.appointment_requests
  add column if not exists booking_number  bigint,
  add column if not exists guest_name      text,
  add column if not exists guest_mobile    text,
  add column if not exists guest_gender    text,
  add column if not exists service_text    text,
  add column if not exists requested_start timestamptz,
  add column if not exists requested_end   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'appointment_requests_patient_or_website'
                    and conrelid = 'public.appointment_requests'::regclass) then
    alter table public.appointment_requests
      add constraint appointment_requests_patient_or_website
      check (patient_id is not null
             or (source = 'website' and nullif(btrim(coalesce(guest_name, '')), '') is not null
                 and nullif(btrim(coalesce(guest_mobile, '')), '') is not null));
  end if;
end $$;

create unique index if not exists uq_appointment_requests_booking_number
  on public.appointment_requests (organization_id, booking_number)
  where booking_number is not null;
create index if not exists idx_appointment_requests_website
  on public.appointment_requests (organization_id, status, requested_start)
  where source = 'website';

comment on column public.appointment_requests.booking_number is
  'رقم حجز الموقع الإلكتروني — متسلسل لكلّ منشأة، يُعطى للحاجز. 0226.';

-- ── ٢) التواصل والعنوان (إعلان المجمع) ──────────────────────────────────────
update public.public_booking_settings
   set phone = '0540862125',
       address = 'الطائف — طريق الملك خالد، مقابل مغسلة الجبر',
       updated_at = now()
 where is_enabled;

-- ── ٣) الفهرس: العيادات النشطة التي فيها طبيبٌ متاح، وأطباؤها بتخصّصهم ─────
create or replace function public.app_public_bookable_doctors(p_org uuid)
returns table (doctor_id uuid, doctor_name text, specialty text, clinic_id uuid, clinic_name text,
               clinic_sort int, duration_minutes int, branch_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id,
         btrim(regexp_replace(d.name_ar, '^\s*(د|الدكتور|الدكتورة|دكتور|دكتورة)\s*\.?\s*', '')),
         coalesce(nullif(btrim(lv.name_ar), ''), nullif(btrim(d.job_title), '')),
         c.id,
         c.name,
         coalesce(c.sort_order, 0),
         greatest(10, least(240, coalesce(d.default_appointment_duration_minutes, c.default_visit_duration, 30))),
         c.branch_id
    from public.doctors d
    join public.clinics c
      on c.id = d.clinic_id
     and c.organization_id = d.organization_id
     and not coalesce(c.is_disabled, false)
    left join public.lookup_values lv on lv.id = d.specialty_value_id
   where d.organization_id = p_org
     and coalesce(d.is_enabled, true)
     and not coalesce(d.disabled_from_booking, false);
$$;
revoke all on function public.app_public_bookable_doctors(uuid) from public, anon, authenticated;

create or replace function public.app_public_booking_catalog(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
begin
  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug))
     and is_enabled;
  if v_setting.organization_id is null then
    raise exception 'موقع الحجز غير متاح';
  end if;

  return jsonb_build_object(
    'site_name', v_setting.site_name,
    'hero_title', v_setting.hero_title,
    'hero_subtitle', v_setting.hero_subtitle,
    'phone', v_setting.phone,
    'address', v_setting.address,
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.clinic_id, 'name', x.clinic_name)
                       order by x.clinic_sort, x.clinic_name)
        from (select distinct clinic_id, clinic_name, clinic_sort
                from public.app_public_bookable_doctors(v_setting.organization_id)) x
    ), '[]'::jsonb),
    'doctors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.doctor_id, 'name', b.doctor_name, 'job_title', b.specialty,
               'specialty', b.specialty, 'clinic_id', b.clinic_id)
             order by b.doctor_name)
        from public.app_public_bookable_doctors(v_setting.organization_id) b
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.doctor_id, 'name', b.doctor_name, 'job_title', b.specialty,
               'specialty', b.specialty, 'clinic_id', b.clinic_id)
             order by b.clinic_sort, b.doctor_name)
        from public.app_public_bookable_doctors(v_setting.organization_id) b
    ), '[]'::jsonb),
    'services', '[]'::jsonb
  );
end;
$$;
revoke all on function public.app_public_booking_catalog(text) from public;
grant execute on function public.app_public_booking_catalog(text) to anon, authenticated;

-- ── ٤) الأوقات المتاحة من دوام الطبيب (أو كلّ أطباء العيادة) ────────────────
-- داخلية (لا تُستدعى من المتصفّح): دوام الطبيب في العيادة، بمدّة موعده،
-- بلا تقاطع مع موعدٍ يشغل الوقت، ولا مع إجازة، ولا مع حجز موقعٍ معلّق له.
create or replace function public.app_public_free_slots(
  p_org uuid, p_clinic_id uuid, p_doctor_id uuid, p_from date, p_days int)
returns table (doctor_id uuid, slot_start timestamptz, slot_end timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with docs as (
    select b.* from public.app_public_bookable_doctors(p_org) b
     where b.clinic_id = p_clinic_id
       and (p_doctor_id is null or b.doctor_id = p_doctor_id)
  ),
  days as (
    select (p_from + g)::date as day
      from generate_series(0, greatest(1, least(coalesce(p_days, 30), 60)) - 1) g
  ),
  ranges as (
    select d.doctor_id, d.duration_minutes, r.starts_at, r.ends_at, coalesce(r.capacity, 1) as capacity
      from docs d
      cross join days
      cross join lateral public.app_doctor_working_ranges(d.doctor_id, days.day, p_clinic_id) r
  ),
  slots as (
    select r.doctor_id, s as slot_start, s + make_interval(mins => r.duration_minutes) as slot_end, r.capacity
      from ranges r
      cross join lateral generate_series(
        r.starts_at, r.ends_at - make_interval(mins => r.duration_minutes),
        make_interval(mins => r.duration_minutes)) s
  )
  select s.doctor_id, s.slot_start, s.slot_end
    from slots s
   where s.slot_start >= now() + interval '1 hour'
     and (select count(*) from public.app_doctor_busy_ranges(p_org, s.doctor_id, null, s.slot_start, s.slot_end))
         < s.capacity
     and not exists (
       select 1 from public.doctor_working_hours h
        where h.doctor_id = s.doctor_id
          and h.is_blocked
          and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(s.slot_start, s.slot_end, '[)'))
     and not exists (
       select 1 from public.appointment_requests q
        where q.organization_id = p_org
          and q.source = 'website'
          and q.status = 'pending'
          and q.doctor_id = s.doctor_id
          and tstzrange(q.requested_start, q.requested_end, '[)') && tstzrange(s.slot_start, s.slot_end, '[)'));
$$;
revoke all on function public.app_public_free_slots(uuid, uuid, uuid, date, int) from public, anon, authenticated;

create or replace function public.app_public_booking_slots(
  p_slug text, p_clinic_id uuid, p_doctor_id uuid default null,
  p_from date default null, p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting public.public_booking_settings%rowtype;
  v_from date := greatest(coalesce(p_from, (now() at time zone 'Asia/Riyadh')::date),
                          (now() at time zone 'Asia/Riyadh')::date);
begin
  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug)) and is_enabled;
  if v_setting.organization_id is null then raise exception 'موقع الحجز غير متاح'; end if;
  if not exists (select 1 from public.app_public_bookable_doctors(v_setting.organization_id) b
                  where b.clinic_id = p_clinic_id
                    and (p_doctor_id is null or b.doctor_id = p_doctor_id)) then
    raise exception 'العيادة أو الطبيب غير متاح للحجز';
  end if;

  return jsonb_build_object('slots', coalesce((
    select jsonb_agg(jsonb_build_object(
             'start', x.slot_start, 'end', x.slot_end,
             'date', to_char(x.slot_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD'),
             'doctors', x.doctors)
           order by x.slot_start)
      from (select f.slot_start, min(f.slot_end) as slot_end, count(distinct f.doctor_id) as doctors
              from public.app_public_free_slots(v_setting.organization_id, p_clinic_id, p_doctor_id,
                                                v_from, least(greatest(coalesce(p_days, 30), 1), 60)) f
             group by f.slot_start) x
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.app_public_booking_slots(text, uuid, uuid, date, int) from public;
grant execute on function public.app_public_booking_slots(text, uuid, uuid, date, int) to anon, authenticated;

-- ── ٥) الحجز من الموقع: طلبٌ برقمٍ متسلسل (لا ملفّ ولا موعد ولا فاتورة) ─────
drop function if exists public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, text, boolean, text);
drop function if exists public.app_public_create_booking(text, text, text, text, text, uuid, uuid, uuid, timestamptz, text, boolean, text);

create or replace function public.app_public_create_booking(
  p_slug text,
  p_name text,
  p_mobile text,
  p_gender text,
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_service_text text,
  p_scheduled_start timestamptz,
  p_consent boolean default false,
  p_website text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_setting  public.public_booking_settings%rowtype;
  v_name     text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_mobile   text := regexp_replace(coalesce(p_mobile, ''), '[^0-9+]', '', 'g');
  v_service  text := regexp_replace(btrim(coalesce(p_service_text, '')), '\s+', ' ', 'g');
  v_clinic   record;
  v_doc_id   uuid;
  v_doc_name text;
  v_doc_spec text;
  v_slot     record;
  v_number   bigint;
  v_id       uuid;
  v_key      text;
  v_u        uuid;
  v_when     text;
begin
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    raise exception 'تعذر إرسال الطلب';
  end if;

  select * into v_setting
    from public.public_booking_settings
   where public_slug = lower(btrim(p_slug)) and is_enabled;
  if v_setting.organization_id is null then raise exception 'موقع الحجز غير متاح'; end if;

  if char_length(v_name) < 3 or char_length(v_name) > 120 then raise exception 'اكتب الاسم الكامل'; end if;
  if v_mobile !~ '^\+?[0-9]{9,15}$' then raise exception 'رقم الجوال غير صحيح'; end if;
  if char_length(v_service) < 2 or char_length(v_service) > 200 then raise exception 'اكتب الخدمة المطلوبة'; end if;
  if p_gender not in ('male', 'female') then raise exception 'اختر الجنس'; end if;
  if not coalesce(p_consent, false) then raise exception 'يجب الموافقة على استخدام البيانات لإتمام الحجز'; end if;
  if p_scheduled_start is null or p_scheduled_start > now() + interval '90 days' then
    raise exception 'اختر موعدًا متاحًا من الجدول';
  end if;

  select b.clinic_id, b.clinic_name, b.branch_id into v_clinic
    from public.app_public_bookable_doctors(v_setting.organization_id) b
   where b.clinic_id = p_clinic_id
   limit 1;
  if v_clinic.clinic_id is null then raise exception 'العيادة غير متاحة للحجز الإلكتروني'; end if;

  if p_doctor_id is not null then
    select b.doctor_id, b.doctor_name, b.specialty into v_doc_id, v_doc_name, v_doc_spec
      from public.app_public_bookable_doctors(v_setting.organization_id) b
     where b.clinic_id = p_clinic_id and b.doctor_id = p_doctor_id;
    if v_doc_id is null then raise exception 'الطبيب غير متاح في العيادة المختارة'; end if;
  end if;

  -- تكرار الحجز من الرقم نفسه
  v_key := md5(v_setting.public_slug || ':' || v_mobile);
  if (select count(*) from public.public_booking_rate_limits
       where booking_key = v_key and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'تم إرسال عدة حجوزات لهذا الرقم؛ حاول لاحقًا أو اتصل بالمركز';
  end if;
  insert into public.public_booking_rate_limits (booking_key) values (v_key);

  if exists (
    select 1 from public.blocked_external_contacts b
     where b.organization_id = v_setting.organization_id
       and b.is_active
       and b.block_type in ('booking', 'all')
       and regexp_replace(coalesce(b.mobile_number, ''), '[^0-9+]', '', 'g') = v_mobile
       and b.starts_at <= now()
       and (b.ends_at is null or b.ends_at > now())
  ) then
    raise exception 'تعذر إتمام الحجز، يرجى التواصل مع المركز';
  end if;

  -- حجزٌ واحد في اللحظة للمنشأة: الرقم المتسلسل والوقت المتاح يُحسمان معًا
  perform pg_advisory_xact_lock(hashtextextended('website_booking:' || v_setting.organization_id::text, 0));

  select f.doctor_id, f.slot_start, f.slot_end into v_slot
    from public.app_public_free_slots(
           v_setting.organization_id, p_clinic_id, p_doctor_id,
           (p_scheduled_start at time zone 'Asia/Riyadh')::date, 1) f
   where f.slot_start = p_scheduled_start
   order by f.slot_end
   limit 1;
  if v_slot.slot_start is null then
    raise exception 'هذا الوقت لم يعد متاحًا — اختر وقتًا آخر';
  end if;

  select coalesce(max(booking_number), 0) + 1 into v_number
    from public.appointment_requests
   where organization_id = v_setting.organization_id;

  insert into public.appointment_requests (
    organization_id, branch_id, patient_id, clinic_id, doctor_id, preferred_date,
    reason, status, source, booking_number, guest_name, guest_mobile, guest_gender,
    service_text, requested_start, requested_end)
  values (
    v_setting.organization_id, coalesce(v_clinic.branch_id, v_setting.branch_id), null, p_clinic_id, p_doctor_id,
    (p_scheduled_start at time zone 'Asia/Riyadh')::date,
    v_service, 'pending', 'website', v_number, v_name, v_mobile, p_gender,
    v_service, v_slot.slot_start, v_slot.slot_end)
  returning id into v_id;

  -- تنبيه الاستقبال (من يسجّل وصول المرضى) — فشله لا يُفشل الحجز
  begin
    v_when := to_char(v_slot.slot_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI');
    for v_u in
      select distinct e.user_id
        from public.v_user_effective_permissions e
       where e.organization_id = v_setting.organization_id
         and e.permission_key = 'reception.check_in'
         and e.is_allowed
         and e.role_key not in ('owner', 'organization_admin')
         and not exists (select 1 from public.doctors d
                          where d.organization_id = e.organization_id and d.user_id = e.user_id)
    loop
      perform public.app_notify(
        v_setting.organization_id, v_u, 'website_booking_new',
        'حجز جديد من الموقع رقم ' || v_number,
        'website_booking:' || v_id::text,
        concat_ws(' · ', v_name, v_mobile, v_when, v_service,
                  coalesce('د. ' || v_doc_name, 'أي طبيب'), v_clinic.clinic_name),
        'operational', 'info', 'appointment_request', v_id, '/reception', v_clinic.branch_id);
    end loop;
  exception when others then
    raise warning 'تنبيه حجز الموقع لم يُكتب (%): %', v_id, sqlerrm;
  end;

  return jsonb_build_object(
    'booking_number', v_number,
    'scheduled_start', v_slot.slot_start,
    'scheduled_end', v_slot.slot_end,
    'patient_name', v_name,
    'patient_mobile', v_mobile,
    'service_text', v_service,
    'doctor_name', v_doc_name,
    'doctor_specialty', v_doc_spec,
    'clinic_name', v_clinic.clinic_name,
    'phone', v_setting.phone,
    'address', v_setting.address,
    'site_name', v_setting.site_name);
end;
$$;
revoke all on function public.app_public_create_booking(text, text, text, text, uuid, uuid, text, timestamptz, boolean, text) from public;
grant execute on function public.app_public_create_booking(text, text, text, text, uuid, uuid, text, timestamptz, boolean, text) to anon, authenticated;

-- الدالّة القديمة كانت تُرجع خانات الطبيب لصنفٍ بعينه — لم يعد لها مستدعٍ
drop function if exists public.app_public_doctor_slots(text, uuid, uuid, uuid, date, int);

-- ── ٦) الاستقبال: العرض، فتح الملفّ، التأكيد، الإلغاء ────────────────────────
create or replace view public.v_website_bookings
with (security_invoker = on) as
select
  r.id, r.organization_id, r.branch_id, r.booking_number, r.created_at,
  r.guest_name, r.guest_mobile, r.guest_gender, r.service_text,
  r.clinic_id, c.name as clinic_name,
  r.doctor_id, d.name_ar as doctor_name,
  r.requested_start, r.requested_end,
  r.status, r.patient_id, p.name_ar as patient_name, p.file_number,
  r.appointment_id, a.scheduled_start as appointment_start, a.status as appointment_status,
  r.decided_at, dc.display_name as decided_by_name, r.decision_note
from public.appointment_requests r
left join public.clinics  c on c.id = r.clinic_id
left join public.doctors  d on d.id = r.doctor_id
left join public.patients p on p.id = r.patient_id
left join public.appointments a on a.id = r.appointment_id
left join public.v_organization_members_directory dc
       on dc.user_id = r.decided_by and dc.organization_id = r.organization_id
where r.source = 'website';

revoke all on public.v_website_bookings from anon;
grant select on public.v_website_bookings to authenticated;

create or replace function public.app_website_booking_staff_check(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not public.app_has_role(p_org, array['owner', 'organization_admin', 'branch_manager', 'receptionist']) then
    raise exception 'حجوزات الموقع للاستقبال وإدارة المنشأة';
  end if;
end $$;
revoke all on function public.app_website_booking_staff_check(uuid) from public, anon, authenticated;

-- فتح ملفّ من بيانات الحاجز، أو ربطه بملفٍّ موجود (p_patient_id)
create or replace function public.app_website_booking_link_patient(
  p_request_id uuid, p_patient_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.appointment_requests%rowtype;
  v_pid  uuid;
  v_new  boolean := false;
begin
  select * into r from public.appointment_requests where id = p_request_id for update;
  if r.id is null or r.source <> 'website' then raise exception 'الحجز غير موجود'; end if;
  perform public.app_website_booking_staff_check(r.organization_id);
  if r.status in ('cancelled', 'rejected') then raise exception 'الحجز ملغى'; end if;

  if p_patient_id is not null then
    select id into v_pid from public.patients
     where id = p_patient_id and organization_id = r.organization_id;
    if v_pid is null then raise exception 'الملف غير موجود في هذه المنشأة'; end if;
  elsif r.patient_id is not null then
    return r.patient_id;
  else
    insert into public.patients (organization_id, branch_id, name_ar, mobile_number, gender,
                                 preferred_language, treating_doctor_id, source_details)
    values (r.organization_id, r.branch_id, r.guest_name, r.guest_mobile, r.guest_gender,
            'ar', r.doctor_id, 'الموقع الإلكتروني — حجز رقم ' || r.booking_number)
    returning id into v_pid;
    v_new := true;
  end if;

  update public.appointment_requests
     set patient_id = v_pid, updated_at = now()
   where id = r.id;

  insert into public.audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (r.organization_id, auth.uid(), 'appointments', case when v_new then 'add' else 'update' end, v_pid,
          'حجز الموقع رقم ' || r.booking_number,
          case when v_new then 'فُتح ملفٌّ جديد من بيانات الحاجز: ' else 'رُبط الحجز بملفٍّ موجود: ' end
          || public.app_patient_label(v_pid));
  return v_pid;
end $$;
revoke all on function public.app_website_booking_link_patient(uuid, uuid) from public, anon;
grant execute on function public.app_website_booking_link_patient(uuid, uuid) to authenticated;

-- التأكيد: موعدٌ مؤكَّد بالوقت المطلوب (أو المعدَّل) وطبيبٍ محدّد
create or replace function public.app_website_booking_confirm(
  p_request_id uuid, p_doctor_id uuid default null, p_start timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        public.appointment_requests%rowtype;
  v_doctor uuid;
  v_start  timestamptz;
  v_end    timestamptz;
  v_mins   int;
  v_appt   uuid;
begin
  select * into r from public.appointment_requests where id = p_request_id for update;
  if r.id is null or r.source <> 'website' then raise exception 'الحجز غير موجود'; end if;
  perform public.app_website_booking_staff_check(r.organization_id);
  if r.status <> 'pending' then raise exception 'الحجز حالته «%» — لا يُؤكَّد مرّتين', r.status; end if;
  if r.patient_id is null then raise exception 'افتح ملف المريض أولًا (أو اربطه بملفٍّ موجود)'; end if;

  v_doctor := coalesce(p_doctor_id, r.doctor_id);
  if v_doctor is null then raise exception 'اختر الطبيب — الحاجز اختار «أي طبيب»'; end if;
  if not exists (select 1 from public.doctors d
                  where d.id = v_doctor and d.organization_id = r.organization_id and coalesce(d.is_enabled, true)) then
    raise exception 'الطبيب غير متاح';
  end if;

  v_start := coalesce(p_start, r.requested_start);
  if v_start is null then raise exception 'حدّد وقت الموعد'; end if;
  v_mins := greatest(5, coalesce(extract(epoch from (r.requested_end - r.requested_start))::int / 60,
                                 (select default_appointment_duration_minutes from public.doctors where id = v_doctor),
                                 30));
  v_end := v_start + make_interval(mins => v_mins);

  insert into public.appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                                   scheduled_start, scheduled_end, status, note, created_by)
  values (r.organization_id, r.branch_id, r.clinic_id, v_doctor, r.patient_id, v_start, v_end,
          'confirmed',
          concat_ws(' — ', 'حجز الموقع الإلكتروني رقم ' || r.booking_number, nullif(btrim(coalesce(r.service_text, '')), '')),
          auth.uid())
  returning id into v_appt;

  update public.appointment_requests
     set status = 'approved', appointment_id = v_appt, doctor_id = v_doctor,
         decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = r.id;

  insert into public.audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (r.organization_id, auth.uid(), 'appointments', 'add', v_appt,
          'تأكيد حجز الموقع رقم ' || r.booking_number,
          concat_ws(' · ', public.app_patient_label(r.patient_id),
                    to_char(v_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'), r.service_text));
  return v_appt;
end $$;
revoke all on function public.app_website_booking_confirm(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.app_website_booking_confirm(uuid, uuid, timestamptz) to authenticated;

create or replace function public.app_website_booking_cancel(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.appointment_requests%rowtype;
begin
  select * into r from public.appointment_requests where id = p_request_id for update;
  if r.id is null or r.source <> 'website' then raise exception 'الحجز غير موجود'; end if;
  perform public.app_website_booking_staff_check(r.organization_id);
  if r.status <> 'pending' then raise exception 'الحجز حالته «%» — يُلغى المعلّق وحده (الموعد المؤكَّد يُلغى من المواعيد)', r.status; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'سبب الإلغاء مطلوب'; end if;

  update public.appointment_requests
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now(),
         decision_note = btrim(p_reason), updated_at = now()
   where id = r.id;

  insert into public.audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (r.organization_id, auth.uid(), 'appointments', 'update', r.id,
          'إلغاء حجز الموقع رقم ' || r.booking_number,
          concat_ws(' · ', r.guest_name, r.guest_mobile, btrim(p_reason)));
end $$;
revoke all on function public.app_website_booking_cancel(uuid, text) from public, anon;
grant execute on function public.app_website_booking_cancel(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── النتيجة ─────────────────────────────────────────────────────────────────
select s.public_slug as "رابط الموقع /booking/…",
       case when s.is_enabled then 'مفعّل' else 'معطّل' end as "الحالة",
       s.phone as "الهاتف",
       (select count(distinct b.clinic_id) from public.app_public_bookable_doctors(s.organization_id) b) as "عيادات تظهر",
       (select count(*) from public.app_public_bookable_doctors(s.organization_id)) as "أطباء يظهرون",
       (select count(*)
          from (select distinct clinic_id from public.app_public_bookable_doctors(s.organization_id)) b1
          cross join lateral public.app_public_free_slots(
                s.organization_id, b1.clinic_id, null, (now() at time zone 'Asia/Riyadh')::date, 7) f)
         as "أوقات متاحة (كلّ العيادات، 7 أيام)"
  from public.public_booking_settings s;
