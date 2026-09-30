-- ============================================================================
-- 0197 — المواعيد: موعد الانتظار، أولوية التقريب، التكرار، ملاحظات اليوم،
--        قائمة انتظار المواعيد برقم حجز، ومن أنشأ الموعد ومن عدّله ومن أكّده
-- ============================================================================
--
-- سدّ فجوات شاشات المواعيد مقابل Kizen (مستند المشروع
-- zaincare-kizen-appointments-spec-2026-09-30)، على الجداول القائمة:
--
--   ١. **موعد الانتظار (W.P)** — `appointments.is_waiting`: موعدٌ ليومٍ وطبيب
--      بلا خانة وقتٍ محجوزة، و`waiting_all_day` إن كان ينتظر طوال اليوم.
--      لا يحجز وقتًا في منع التداخل ولا في شبكة الأوقات حتى يدخل العيادة.
--      وقته المخزَّن بداية دوام الطبيب ذلك اليوم (أو الوقت الذي ينتظر منه)،
--      فيظهر في الاستقبال بوقتٍ معقول لا منتصف الليل.
--        app_doctor_day_start            بداية دوام الطبيب في يوم
--        app_send_appointment_to_waiting موعدٌ محجوز ← انتظار في يومٍ ما
--        app_assign_waiting_slot         انتظار ← خانة وقت (بفحص التداخل)
--   ٢. **أولوية التقريب (P)** — `appointments.accepts_earlier`: «إن فرغت خانة
--      أبكر فاتصلوا بي». تقرؤها الشاشة عند إلغاء موعدٍ أو تأجيله.
--   ٣. **التكرار** — `app_create_appointment_series`: عدّة مواعيد بفاصلٍ ثابت في
--      معاملةٍ واحدة، يمرّ كلّ منها بكلّ حرّاس الإدراج (التداخل والدوام
--      والحجب والخدمة)، و`series_id` يجمعها. تعارضٌ في أيّ منها يُلغي الكلّ
--      ويسمّي رقمه وتاريخه.
--   ٤. **من ومتى** — `updated_by`، `confirmed_at`، `confirmed_by` بمُحفِّز
--      يملؤها (ويُبقي `updated_at` صادقًا — كان لا يتحدّث إلّا من الدوالّ).
--   ٥. **وسم الموعد** — `label_value_id` من لائحة `appointment_labels`
--      (مثل «تم تأجيل الموعد»، «في انتظار المعمل») — حالاتٌ يدوية في Kizen لا
--      تغيّر سير الاستقبال، فمكانها لائحة لا قيد الحالات.
--   ٦. **ملاحظات اليوم والاجتماعات** — جدول `schedule_day_notes` (لا جدول قائم
--      لها: `patient_notes` مربوط بمريض). حذفها أرشفة.
--   ٧. **قائمة انتظار المواعيد** (`appointment_waitlist`): رقم حجز متسلسل لكلّ
--      منشأة، والإخراج بسببٍ ومن ومتى (`app_cancel_waitlist_entry`) لا حذف،
--      وحين يُحجز للمريض موعدٌ عند طبيبه أو في تخصّصه تصير «تم الحجز» وتُربط
--      بالموعد تلقائيًّا.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الأعمدة
-- ═══════════════════════════════════════════════════════════════════════════
alter table appointments
  add column if not exists is_waiting       boolean not null default false,
  add column if not exists waiting_all_day  boolean not null default false,
  add column if not exists accepts_earlier  boolean not null default false,
  add column if not exists series_id        uuid,
  add column if not exists label_value_id   uuid references lookup_values(id),
  add column if not exists updated_by       uuid references auth.users(id),
  add column if not exists confirmed_at     timestamptz,
  add column if not exists confirmed_by     uuid references auth.users(id);

comment on column appointments.is_waiting is
  'موعد انتظار (W.P): ليومٍ وطبيب بلا خانة وقت محجوزة. لا يحجز وقتًا حتى يدخل العيادة.';
comment on column appointments.waiting_all_day is
  'موعد انتظارٍ طوال اليوم — وقته المخزَّن بداية دوام الطبيب.';
comment on column appointments.accepts_earlier is
  'أولوية التقريب (P): يقبل المريض موعدًا أبكر إن فرغت خانة.';
comment on column appointments.series_id is
  'مواعيد أُنشئت معًا بالتكرار تحمل المعرّف نفسه.';
comment on column appointments.label_value_id is
  'وسمٌ يدويّ من لائحة appointment_labels (تم تأجيل الموعد، في انتظار المعمل…).';

create index if not exists idx_appointments_waiting
  on appointments (organization_id, doctor_id, scheduled_start) where is_waiting;
create index if not exists idx_appointments_earlier
  on appointments (organization_id, doctor_id, scheduled_start) where accepts_earlier;
create index if not exists idx_appointments_series on appointments (series_id) where series_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) من عدّل ومتى، ومن أكّد ومتى
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_appointments_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
      new.confirmed_at := now();
      new.confirmed_by := auth.uid();
    end if;
  elsif new.status = 'confirmed' then
    new.confirmed_at := coalesce(new.confirmed_at, now());
    new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
  end if;
  -- موعد الانتظار طوال اليوم وحده «طوال اليوم»
  if not new.is_waiting then
    new.waiting_all_day := false;
  end if;
  return new;
end $$;

drop trigger if exists trg_appointments_stamp on appointments;
create trigger trg_appointments_stamp
  before insert or update on appointments
  for each row execute function app_appointments_stamp();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) موعد الانتظار لا يحجز وقتًا — منع التداخل (منقولة من 0174 كما هي عدا
--    المواضع المعلَّمة 0197)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_doctor_busy_ranges(
  p_organization_id uuid,
  p_doctor_id       uuid,
  p_exclude_id      uuid,
  p_from            timestamptz,
  p_to              timestamptz
)
returns table (
  appointment_id uuid,
  busy           tstzrange,
  in_session     boolean,
  status         text,
  patient_name   text,
  service_name   text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id,
         r.busy,
         (a.entered_at is not null and a.left_at is null and a.status <> 'completed'),
         a.status,
         p.name_ar,
         i.name_ar
    from appointments a
    cross join lateral (
      select app_appointment_busy_range(a.status, a.scheduled_start, a.scheduled_end,
                                        a.entered_at, a.left_at, a.expected_duration_minutes) as busy
    ) r
    left join patients p on p.id = a.patient_id
    left join items    i on i.id = a.item_id
   where a.organization_id = p_organization_id
     and a.doctor_id = p_doctor_id
     and (p_exclude_id is null or a.id <> p_exclude_id)
     -- نافذةٌ تقريبية بالموعد المكتوب تُضيّق البحث بالفهرس، وتتّسع لمن دخل متأخّرًا
     and a.scheduled_start < p_to + interval '12 hours'
     and a.scheduled_end   > p_from - interval '12 hours'
     and r.busy is not null
     -- (0197) موعد الانتظار لا يحجز وقتًا بعينه حتى يدخل المريض العيادة
     and (not coalesce(a.is_waiting, false) or a.entered_at is not null)
     and r.busy && tstzrange(p_from, p_to, '[)');
$$;

revoke all on function app_doctor_busy_ranges(uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function app_prevent_appointment_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_info   jsonb;
  v_tz     constant text := 'Asia/Riyadh';
  v_next   timestamptz;
  v_msg    text;
begin
  if new.scheduled_end <= new.scheduled_start then
    raise exception 'وقت نهاية الموعد يجب أن يكون بعد وقت البداية';
  end if;

  -- المنتهي والملغى والحاضر بلا موعد: لا يحجز وقتًا
  -- (0197) وموعد الانتظار (W.P): ليومٍ وطبيب بلا خانة وقت — لا يحجز وقتًا
  if new.status in ('completed','no_show','cancelled_by_patient','cancelled_by_staff','waiting','walk_in')
     or coalesce(new.is_waiting, false) then
    new.overlap_override := false;
    return new;
  end if;

  -- تغيّر الحالة أو الدخول لا يُعيد الفحص: ذلك واقعٌ يُسجَّل لا حجزٌ يُقرَّر
  if tg_op = 'UPDATE'
     and new.organization_id is not distinct from old.organization_id
     and new.doctor_id       is not distinct from old.doctor_id
     and new.scheduled_start = old.scheduled_start
     and new.scheduled_end   = old.scheduled_end then
    new.overlap_override := false;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || new.doctor_id::text, 0));

  v_info := app_doctor_overlap_info(new.organization_id, new.doctor_id,
                                    new.scheduled_start, new.scheduled_end, new.id,
                                    coalesce(app_is_member(new.organization_id), false));

  if v_info is null then
    new.overlap_override := false;
    return new;
  end if;

  -- التجاوز المؤكَّد: يُسجَّل ويُستهلك
  if coalesce(new.overlap_override, false) then
    new.overlap_override      := false;
    new.overlap_overridden_by := auth.uid();
    new.overlap_overridden_at := now();
    return new;
  end if;

  v_next := (v_info ->> 'next_free')::timestamptz;
  v_msg := format(
    'الطبيب مشغول من %s حتى %s%s — احجز من %s فما بعد',
    to_char((v_info ->> 'busy_from')::timestamptz  at time zone v_tz, 'HH24:MI'),
    to_char((v_info ->> 'busy_until')::timestamptz at time zone v_tz, 'HH24:MI'),
    case when (v_info ->> 'in_session')::boolean then ' (المريض داخل الآن)' else '' end,
    to_char(v_next at time zone v_tz,
            case when (v_next at time zone v_tz)::date <> (new.scheduled_start at time zone v_tz)::date
                 then 'YYYY-MM-DD HH24:MI' else 'HH24:MI' end));

  raise exception using
    errcode = 'P0001',
    message = v_msg,
    detail  = v_info::text,
    hint    = 'ZC_APPOINTMENT_OVERLAP';
end;
$$;

drop trigger if exists trg_prevent_appointment_overlap on appointments;
create trigger trg_prevent_appointment_overlap
  before insert or update of organization_id, doctor_id, scheduled_start, scheduled_end, status, is_waiting
  on appointments for each row execute function app_prevent_appointment_overlap();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) بداية دوام الطبيب في يوم — وقتُ موعد الانتظار
--
-- أوّل فترة دوامٍ له ذلك اليوم. وبلا جدولٍ أصلًا: الثامنة صباحًا (اليوم كلّه
-- متاحٌ له كما تحكم app_check_doctor_availability). وله جدولٌ ولا دوام اليوم:
-- null — لا يعمل.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_doctor_day_start(p_doctor_id uuid, p_date date)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_start timestamptz;
begin
  select organization_id into v_org from doctors where id = p_doctor_id;
  if v_org is null or not app_is_member(v_org) then
    raise exception 'الطبيب غير موجود أو لا صلاحية على منشأته';
  end if;
  select min(r.starts_at) into v_start from app_doctor_working_ranges(p_doctor_id, p_date, null) r;
  if v_start is not null then
    return v_start;
  end if;
  if exists (select 1 from doctor_schedules s
              where s.doctor_id = p_doctor_id and s.is_active
                and s.effective_from <= p_date
                and (s.effective_to is null or s.effective_to >= p_date)) then
    return null;
  end if;
  return (p_date + time '08:00') at time zone 'Asia/Riyadh';
end $$;

revoke all on function app_doctor_day_start(uuid, date) from public, anon;
grant execute on function app_doctor_day_start(uuid, date) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) إرسال موعدٍ إلى الانتظار — في يومٍ ما، طوال اليوم أو من وقتٍ بعينه
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_send_appointment_to_waiting(
  p_appointment_id uuid,
  p_date           date,
  p_from_time      time default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v       appointments%rowtype;
  v_start timestamptz;
  v_block text;
  v_mins  int;
begin
  select * into v from appointments where id = p_appointment_id for update;
  if v.id is null then raise exception 'الموعد غير موجود'; end if;
  if not app_has_permission(v.organization_id, 'appointments.update') then
    raise exception 'صلاحيتك لا تسمح بتعديل المواعيد (appointments.update)';
  end if;
  if v.status not in ('new', 'scheduled', 'confirmed', 'unconfirmed') then
    raise exception 'لا يُرسل إلى الانتظار إلّا موعدٌ لم يحضر صاحبه بعد';
  end if;
  if p_date is null or p_date < (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'اختر اليوم أو يومًا قادمًا';
  end if;

  if p_from_time is not null then
    v_start := (p_date + p_from_time) at time zone 'Asia/Riyadh';
  else
    v_start := app_doctor_day_start(v.doctor_id, p_date);
    if v_start is null then
      raise exception 'الطبيب لا يعمل يوم %', to_char(p_date, 'YYYY-MM-DD');
    end if;
  end if;

  v_block := app_check_doctor_availability(v.doctor_id, v_start, v_start + interval '1 minute');
  if v_block is not null then
    raise exception '%', v_block;
  end if;

  v_mins := greatest(1, round(extract(epoch from (v.scheduled_end - v.scheduled_start)) / 60)::int);
  update appointments
     set is_waiting                = true,
         waiting_all_day           = (p_from_time is null),
         scheduled_start           = v_start,
         scheduled_end             = v_start + interval '15 minutes',
         -- مدّة الموعد الأصلية تبقى لحين تُعطى له خانة
         expected_duration_minutes = coalesce(expected_duration_minutes, least(v_mins, 600))
   where id = p_appointment_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v.organization_id, auth.uid(), 'appointments', 'update', p_appointment_id, 'إرسال موعد إلى الانتظار',
          format('من %s إلى انتظار يوم %s%s',
                 to_char(v.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
                 to_char(p_date, 'YYYY-MM-DD'),
                 case when p_from_time is null then ' طوال اليوم' else ' من ' || to_char(p_from_time, 'HH24:MI') end));
  return v_start;
end $$;

revoke all on function app_send_appointment_to_waiting(uuid, date, time) from public, anon;
grant execute on function app_send_appointment_to_waiting(uuid, date, time) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) من الانتظار إلى خانة وقت — بفحص الدوام والتداخل كأيّ حجز
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_assign_waiting_slot(
  p_appointment_id uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_override       boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v       appointments%rowtype;
  v_block text;
begin
  select * into v from appointments where id = p_appointment_id for update;
  if v.id is null then raise exception 'الموعد غير موجود'; end if;
  if not app_has_permission(v.organization_id, 'appointments.update') then
    raise exception 'صلاحيتك لا تسمح بتعديل المواعيد (appointments.update)';
  end if;
  if not v.is_waiting then
    raise exception 'الموعد ليس في الانتظار';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'وقت نهاية الموعد يجب أن يكون بعد وقت البداية';
  end if;
  v_block := app_check_doctor_availability(v.doctor_id, p_start, p_end);
  if v_block is not null then
    raise exception '%', v_block;
  end if;

  -- مُحفِّز منع التداخل يفحص الخانة الآن (لم يعد انتظارًا)
  update appointments
     set is_waiting       = false,
         waiting_all_day  = false,
         scheduled_start  = p_start,
         scheduled_end    = p_end,
         overlap_override = coalesce(p_override, false)
   where id = p_appointment_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v.organization_id, auth.uid(), 'appointments', 'update', p_appointment_id, 'حجز خانة لموعد انتظار',
          to_char(p_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'));
end $$;

revoke all on function app_assign_waiting_slot(uuid, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function app_assign_waiting_slot(uuid, timestamptz, timestamptz, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) تكرار الموعد — عدّة مواعيد في معاملةٍ واحدة
--
-- `p_appointment`: حقول الموعد الأوّل كما يُدرجها نموذج الحجز
--   (organization_id, patient_id, doctor_id, clinic_id, branch_id, item_id,
--    visit_type_value_id, priority, note, accepts_earlier, scheduled_start,
--    scheduled_end). والبقيّة كلّ `p_every_days` يومًا، `p_count` موعدًا كلّها.
-- بصلاحيات المستخدم نفسه (security invoker): سياسة الإدراج وكلّ مُحفِّزات
-- الحجز تسري على كلّ موعد كما لو حُجز وحده.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_create_appointment_series(
  p_appointment jsonb,
  p_count       int,
  p_every_days  int,
  p_override    boolean default false
)
returns uuid[]
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_series uuid := gen_random_uuid();
  v_start  timestamptz := (p_appointment->>'scheduled_start')::timestamptz;
  v_end    timestamptz := (p_appointment->>'scheduled_end')::timestamptz;
  v_org    uuid := (p_appointment->>'organization_id')::uuid;
  v_ids    uuid[] := '{}';
  v_id     uuid;
  v_at     timestamptz;
  k        int;
  v_msg    text;
  v_det    text;
  v_hint   text;
begin
  if p_count is null or p_count < 2 or p_count > 52 then
    raise exception 'عدد التكرار بين 2 و52';
  end if;
  if p_every_days is null or p_every_days < 1 or p_every_days > 90 then
    raise exception 'فاصل التكرار بين يوم و90 يومًا';
  end if;
  if v_start is null or v_end is null or v_end <= v_start then
    raise exception 'وقت نهاية الموعد يجب أن يكون بعد وقت البداية';
  end if;
  if not app_has_permission(v_org, 'appointments.create') then
    raise exception 'صلاحيتك لا تسمح بحجز المواعيد (appointments.create)';
  end if;

  for k in 0 .. p_count - 1 loop
    v_at := v_start + make_interval(days => k * p_every_days);
    begin
      insert into appointments (
        organization_id, patient_id, doctor_id, clinic_id, branch_id, item_id, visit_type_value_id,
        priority, note, accepts_earlier, label_value_id, scheduled_start, scheduled_end, status, created_by,
        overlap_override, series_id)
      values (
        v_org,
        (p_appointment->>'patient_id')::uuid,
        (p_appointment->>'doctor_id')::uuid,
        nullif(p_appointment->>'clinic_id', '')::uuid,
        nullif(p_appointment->>'branch_id', '')::uuid,
        nullif(p_appointment->>'item_id', '')::uuid,
        nullif(p_appointment->>'visit_type_value_id', '')::uuid,
        coalesce(nullif(p_appointment->>'priority', ''), 'normal'),
        nullif(btrim(coalesce(p_appointment->>'note', '')), ''),
        coalesce((p_appointment->>'accepts_earlier')::boolean, false),
        nullif(p_appointment->>'label_value_id', '')::uuid,
        v_at, v_at + (v_end - v_start), 'scheduled', auth.uid(),
        coalesce(p_override, false), v_series)
      returning id into v_id;
    exception when others then
      get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail, v_hint = pg_exception_hint;
      -- تعارض التداخل يبقى بصيغته (detail/hint) فتعرضه الشاشة كما تعرض تعارض الموعد الواحد
      raise exception using
        errcode = 'P0001',
        message = format('الموعد رقم %s (%s): %s', k + 1,
                         to_char(v_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'), v_msg),
        detail  = coalesce(v_det, ''),
        hint    = coalesce(v_hint, '');
    end;
    v_ids := v_ids || v_id;
  end loop;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_org, auth.uid(), 'appointments', 'add', v_ids[1], 'حجز مواعيد متكرّرة',
          format('%s مواعيد كلّ %s يوم من %s', p_count, p_every_days,
                 to_char(v_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')));
  return v_ids;
end $$;

revoke all on function app_create_appointment_series(jsonb, int, int, boolean) from public, anon;
grant execute on function app_create_appointment_series(jsonb, int, int, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) ملاحظات اليوم والاجتماعات — تخصّ اليوم لا المريض
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists schedule_day_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  note_date       date not null,
  note_time       time,
  kind            text not null default 'note' check (kind in ('note', 'meeting')),
  person_name     text,
  description     text not null check (btrim(description) <> ''),
  is_archived     boolean not null default false,
  archived_at     timestamptz,
  archived_by     uuid references auth.users(id),
  archive_reason  text,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_schedule_day_notes_day
  on schedule_day_notes (organization_id, note_date) where not is_archived;

comment on table schedule_day_notes is
  'ملاحظات اليوم والاجتماعات في جدول المواعيد (Kizen «الملاحظات والاجتماعات»). الحذف أرشفة.';

alter table schedule_day_notes enable row level security;
drop policy if exists schedule_day_notes_read on schedule_day_notes;
create policy schedule_day_notes_read on schedule_day_notes for select to authenticated
  using (app_has_permission(organization_id, 'appointments.view'));
drop policy if exists schedule_day_notes_insert on schedule_day_notes;
create policy schedule_day_notes_insert on schedule_day_notes for insert to authenticated
  with check (app_has_permission(organization_id, 'appointments.create'));
drop policy if exists schedule_day_notes_update on schedule_day_notes;
create policy schedule_day_notes_update on schedule_day_notes for update to authenticated
  using (app_has_permission(organization_id, 'appointments.update'))
  with check (app_has_permission(organization_id, 'appointments.update'));
revoke all on schedule_day_notes from anon;
grant select, insert, update on schedule_day_notes to authenticated;

create or replace function app_schedule_day_notes_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();
    new.organization_id := old.organization_id;
    if new.is_archived and not old.is_archived then
      if nullif(btrim(coalesce(new.archive_reason, '')), '') is null then
        raise exception 'سبب الحذف مطلوب';
      end if;
      new.archived_at := now();
      new.archived_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_schedule_day_notes_stamp on schedule_day_notes;
create trigger trg_schedule_day_notes_stamp
  before insert or update on schedule_day_notes
  for each row execute function app_schedule_day_notes_stamp();

drop trigger if exists trg_audit_schedule_day_notes on schedule_day_notes;
create trigger trg_audit_schedule_day_notes
  after insert or update on schedule_day_notes
  for each row execute function app_audit_log_auto('description');

-- ═══════════════════════════════════════════════════════════════════════════
-- ٩) قائمة انتظار المواعيد: رقم حجز، إخراجٌ بسبب، وربطٌ تلقائيّ بالموعد
-- ═══════════════════════════════════════════════════════════════════════════
alter table appointment_waitlist
  add column if not exists booking_number bigint,
  add column if not exists cancel_reason  text,
  add column if not exists cancelled_at   timestamptz,
  add column if not exists cancelled_by   uuid references auth.users(id);

-- الأرقام للقائم بترتيب تسجيله، والتسلسل يكمل بعده
do $$
declare r record;
begin
  for r in select distinct organization_id from appointment_waitlist where booking_number is null loop
    with n as (
      select id, row_number() over (order by created_at, id)
                 + coalesce((select max(booking_number) from appointment_waitlist
                              where organization_id = r.organization_id), 0) as bn
        from appointment_waitlist
       where organization_id = r.organization_id and booking_number is null
    )
    update appointment_waitlist w set booking_number = n.bn from n where n.id = w.id;

    insert into document_number_sequences (organization_id, branch_id, document_kind, current_value)
    values (r.organization_id, null, 'waitlist',
            (select max(booking_number) from appointment_waitlist where organization_id = r.organization_id))
    on conflict (organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), document_kind)
    do update set current_value = greatest(document_number_sequences.current_value, excluded.current_value);
  end loop;
end $$;

create unique index if not exists uq_waitlist_booking_number
  on appointment_waitlist (organization_id, booking_number);

create or replace function app_waitlist_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.booking_number is null then
    -- تسلسل المنشأة لا الفرع: رقم الحجز يعرفه المريض عبر الفروع
    insert into document_number_sequences (organization_id, branch_id, document_kind, current_value)
    values (new.organization_id, null, 'waitlist', 0)
    on conflict do nothing;
    update document_number_sequences
       set current_value = current_value + 1, updated_at = now()
     where organization_id = new.organization_id and branch_id is null and document_kind = 'waitlist'
    returning current_value into new.booking_number;
  end if;
  return new;
end $$;

drop trigger if exists trg_waitlist_assign_number on appointment_waitlist;
create trigger trg_waitlist_assign_number
  before insert on appointment_waitlist
  for each row execute function app_waitlist_assign_number();

-- الإخراج من القائمة بسبب — لا حذف
create or replace function app_cancel_waitlist_entry(p_waitlist_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare w appointment_waitlist%rowtype;
begin
  select * into w from appointment_waitlist where id = p_waitlist_id for update;
  if w.id is null then raise exception 'السجلّ غير موجود'; end if;
  if not app_has_permission(w.organization_id, 'appointments.update') then
    raise exception 'صلاحيتك لا تسمح بتعديل قائمة الانتظار (appointments.update)';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'سبب الإخراج مطلوب';
  end if;
  if w.status <> 'waiting' then
    raise exception 'لا يُخرج إلّا من هو في الانتظار';
  end if;
  update appointment_waitlist
     set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid()
   where id = p_waitlist_id;
end $$;

revoke all on function app_cancel_waitlist_entry(uuid, text) from public, anon;
grant execute on function app_cancel_waitlist_entry(uuid, text) to authenticated;

-- حُجز للمريض موعد عند طبيبه في القائمة أو في تخصّصها ⇒ «تم الحجز» ويُربط
create or replace function app_waitlist_link_booked()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spec    uuid;
  v_sub     uuid;
  v_sub_par uuid;
  v_w       uuid;
  v_status  text;
begin
  -- مُحفِّزٌ مؤجَّل إلى نهاية المعاملة: يُقرأ الموعد كما صار لا كما أُدرج،
  -- وما ربطته دالّةٌ بعينها (تحويل طلب الانتظار إلى موعد) يُترك كما هو.
  select a.status into v_status from appointments a where a.id = new.id;
  if v_status is null or v_status in ('cancelled_by_patient', 'cancelled_by_staff', 'no_show') then
    return null;
  end if;
  if exists (select 1 from appointment_waitlist where appointment_id = new.id) then
    return null;
  end if;
  select d.specialty_value_id, d.subspecialty_value_id, sv.parent_value_id
    into v_spec, v_sub, v_sub_par
    from doctors d left join lookup_values sv on sv.id = d.subspecialty_value_id
   where d.id = new.doctor_id;

  select w.id into v_w
    from appointment_waitlist w
   where w.organization_id = new.organization_id
     and w.patient_id = new.patient_id
     and w.status = 'waiting'
     and (w.doctor_id = new.doctor_id
          or (w.doctor_id is null
              and (w.specialty_value_id is null
                   or w.specialty_value_id in (v_spec, v_sub, v_sub_par))))
   order by (w.doctor_id = new.doctor_id) desc nulls last, w.created_at
   limit 1
   for update skip locked;

  if v_w is not null then
    update appointment_waitlist
       set status = 'booked', appointment_id = new.id, booked_at = now()
     where id = v_w;
  end if;
  return null;
end $$;

-- مؤجَّل (constraint trigger): `app_convert_waitlist_to_appointment` تُدرج الموعد
-- ثمّ تربط طلبها به؛ مُحفِّزٌ فوريّ كان يسبقها فيربط طلبًا آخر للمريض نفسه بالموعد
-- فتفشل الدالّة على تفرّد `appointment_id`. بالتأجيل تربط الدالّة أوّلًا ويُترك.
drop trigger if exists trg_waitlist_link_booked on appointments;
create constraint trigger trg_waitlist_link_booked
  after insert on appointments
  deferrable initially deferred
  for each row execute function app_waitlist_link_booked();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٩ب) إلغاء الموعد — من المنشأة أو اعتذار المريض (Kizen «اعتذر عن الموعد»)
--
-- نافذة إدارة الموعد كانت تكتب الإلغاء بـ`update` مباشر، فيمرّ إلغاء موعدٍ عليه
-- فاتورة محصَّلة، ولا يُكتب سطر تدقيق. الآن دالّةٌ واحدة بصلاحية
-- `appointments.cancel` وحارس الفاتورة نفسه الذي في إلغاء الطابور (0158).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_cancel_appointment(
  p_appointment_id uuid,
  p_reason         text,
  p_by_patient     boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v      appointments%rowtype;
  v_next text := case when coalesce(p_by_patient, false) then 'cancelled_by_patient' else 'cancelled_by_staff' end;
begin
  select * into v from appointments where id = p_appointment_id for update;
  if v.id is null then raise exception 'الموعد غير موجود'; end if;
  if not app_has_permission(v.organization_id, 'appointments.cancel') then
    raise exception 'صلاحيتك لا تسمح بإلغاء المواعيد (appointments.cancel)';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'سبب الإلغاء مطلوب';
  end if;
  if v.status in ('completed', 'no_show', 'cancelled_by_patient', 'cancelled_by_staff') then
    raise exception 'الموعد «%» لا يُلغى', v.status;
  end if;
  if coalesce(p_by_patient, false) and v.status not in ('new', 'scheduled', 'unconfirmed', 'confirmed') then
    raise exception 'اعتذار المريض قبل حضوره فقط — بعد الحضور يُلغى من المنشأة';
  end if;
  if exists (
    select 1 from sales_invoices s
     where s.appointment_id = v.id
       and s.invoice_type = 'sale'
       and coalesce(s.status, '') <> 'void'
       and coalesce(s.paid_amount, 0) > 0
  ) then
    raise exception 'على الموعد فاتورة محصَّلة — عالِج الفاتورة (استرداد أو إلغاء) قبل إلغاء الموعد';
  end if;

  update appointments
     set status = v_next, cancellation_reason = btrim(p_reason)
   where id = v.id;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, reason)
  values (v.organization_id, auth.uid(), 'update', 'appointments', v.id,
          case when coalesce(p_by_patient, false) then 'اعتذار المريض عن الموعد' else 'إلغاء موعد' end,
          jsonb_build_object('from', v.status, 'to', v_next)::text, btrim(p_reason));
end $$;

revoke all on function app_cancel_appointment(uuid, text, boolean) from public, anon;
grant execute on function app_cancel_appointment(uuid, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١٠) لائحة وسوم الموعد
-- ═══════════════════════════════════════════════════════════════════════════
insert into lookup_categories (key, name_ar, name_en)
select 'appointment_labels', 'وسوم المواعيد', 'Appointment labels'
 where not exists (select 1 from lookup_categories where key = 'appointment_labels' and organization_id is null);

commit;

notify pgrst, 'reload schema';

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
declare v_missing text;
begin
  select string_agg(f, '، ') into v_missing
    from unnest(array['app_doctor_day_start', 'app_send_appointment_to_waiting', 'app_assign_waiting_slot',
                      'app_create_appointment_series', 'app_cancel_waitlist_entry', 'app_waitlist_link_booked',
                      'app_cancel_appointment',
                      'app_appointments_stamp']) f
   where not exists (select 1 from pg_proc where proname = f);
  if v_missing is not null then raise exception 'دوالّ ناقصة: %', v_missing; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_waitlist_assign_number') then
    raise exception 'مُحفِّز رقم الحجز لم يُركَّب';
  end if;
end $$;
