-- ---------------------------------------------------------------------------
-- 0174 — تعارض المواعيد: الوقت المحجوز يُرى، ويُقال «احجز من كذا»، ويُتجاوز بتأكيد
--
-- المطلوب: خدمةٌ مدّتها ٤٥ دقيقة مع د. أمجد، وجاء مريضٌ آخر يُراد حجزه في
-- الوقت نفسه — والمريض الأوّل داخل. البرنامج يرفض، ويُظهر الوقت محجوبًا،
-- ويقول «احجز بعد الساعة كذا»، ويعطي خيار «تجاهل» مع تأكيده.
--
-- ── ما كان قائمًا وما كان ناقصًا ──────────────────────────────────────────
--
-- منع التداخل موجودٌ منذ 0050 (`app_prevent_appointment_overlap`) ومدّة الخدمة
-- تضبط مدّة الموعد منذ 0081. لكن:
--
--   (١) **كان يقيس بالموعد المكتوب لا بالواقع.** موعدٌ ١٠:٠٠–١٠:٤٥ دخل صاحبه
--       ١٠:٣٠ يشغل الطبيب حتى ١١:١٥ — وكان يُقبل حجزٌ في ١٠:٤٥ لأنّ الورقة
--       تقول إنّ الطبيب فرغ. وحاضرٌ بلا موعد دخل الغرفة لم يكن يشغل شيئًا.
--   (٢) **ورسالته لا تقول متى.** «يوجد موعد آخر يتداخل» تجعل الموظّف يجرّب
--       الأوقات واحدًا واحدًا.
--   (٣) **ولا تجاوز.** الطبيب الذي يقبل مريضًا طارئًا فوق جدوله كان يُسجَّل
--       خارج النظام.
--   (٤) **وثلاثة أماكن تحسب «المشغول» بثلاث طرق:** المُحفِّز، وشبكة الأوقات
--       المتاحة، و«أقرب موعد». فتعرض الشبكة خانةً فارغة يرفضها الحفظ.
--
-- ── ما تفعله هذه الترقية ──────────────────────────────────────────────────
--
--   • `app_appointment_busy_range` — **تعريفٌ واحد للمشغول** تقرؤه الأماكن
--     الثلاثة:
--       - الملغى ومن لم يحضر: لا يشغل.
--       - دخل وخرج: ما بين الدخول والخروج فعلًا.
--       - داخلٌ الآن: من لحظة دخوله حتى تنقضي مدّة جلسته — وإن طالت عن
--         مدّتها فحتى الآن.
--       - انتهى بلا دخولٍ مسجَّل، أو حاضرٌ ينتظر ولم يدخل: لا يشغل وقتًا بعينه.
--       - وما عداه: الموعد كما كُتب.
--   • المُحفِّز يرفض برسالةٍ تقول **من كم إلى كم، وهل المريض داخل، ومن أيّ
--     ساعةٍ يُحجز** — وأقرب وقتٍ يتّسع للمدّة كاملة لا مجرّد نهاية التعارض
--     الأوّل، فقد يليه تعارضٌ ثانٍ.
--   • والتفاصيل نفسها تُرسَل مقروءةً آليًّا (`detail` + `hint`) فتعرضها
--     الواجهة نافذةً بخيارين: «انقل إلى الوقت المتاح» أو «تجاهل التعارض» ثم
--     «تأكيد التجاهل».
--   • **التجاهل يُسجَّل ولا يبقى مفتوحًا:** العمود `overlap_override` يُستهلك
--     في العملية نفسها ويعود `false`، ويبقى من تجاوز ومتى في
--     `overlap_overridden_by` و`overlap_overridden_at`. فنقلُ الموعد لاحقًا
--     يُفحص من جديد ولا يرث تجاوزًا قديمًا.
--   • **وتغيّر الحالة لا يُعيد الفحص:** دخول المريض أو ندائه واقعٌ يُسجَّل لا
--     حجزٌ يُقرَّر. كان المُحفِّز يعمل على تغيّر الحالة أيضًا، فكان نداء حاضرٍ
--     بلا موعد يُرفض إن صادف وقتُ وصوله موعدًا لغيره.
--
-- **الخصوصية:** رسالة الرفض تصل أيضًا إلى صفحة الحجز العامّة. فلا اسمَ مريضٍ
-- فيها أبدًا، والأسماء في التفاصيل لأعضاء المنشأة وحدهم.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) أعمدة التجاوز
-- ═══════════════════════════════════════════════════════════════════════════
alter table appointments
  add column if not exists overlap_override      boolean not null default false,
  add column if not exists overlap_overridden_by uuid references auth.users(id),
  add column if not exists overlap_overridden_at timestamptz;

comment on column appointments.overlap_override is
  'طلبُ تجاوزٍ يُستهلك في عملية الحفظ نفسها ويعود false — لا يُقرأ بعدها. الأثر الباقي في overlap_overridden_by/at.';
comment on column appointments.overlap_overridden_by is
  'من أكّد حجز هذا الموعد رغم تعارضه مع موعدٍ آخر للطبيب نفسه.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) المشغول — تعريفٌ واحد
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_appointment_busy_range(
  p_status           text,
  p_start            timestamptz,
  p_end              timestamptz,
  p_entered_at       timestamptz,
  p_left_at          timestamptz,
  p_expected_minutes integer
)
returns tstzrange
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_status in ('cancelled_by_patient', 'cancelled_by_staff', 'no_show') then null

    -- داخلٌ الآن: من دخوله حتى تنقضي مدّته — وإن تجاوزها فحتى الآن. وجلسةٌ
    -- عمرها فوق اثنتي عشرة ساعة لم تُغلق سهوًا لا تُمدّ إلى الآن فتحجب اليوم كلّه.
    when p_entered_at is not null and p_left_at is null and p_status <> 'completed' then
      tstzrange(
        p_entered_at,
        case when p_entered_at > now() - interval '12 hours'
             then greatest(p_entered_at + make_interval(mins => coalesce(p_expected_minutes,
                    greatest(1, round(extract(epoch from (p_end - p_start)) / 60)::int))), now())
             else p_entered_at + make_interval(mins => coalesce(p_expected_minutes,
                    greatest(1, round(extract(epoch from (p_end - p_start)) / 60)::int)))
        end,
        '[)')

    -- دخل وخرج (أو انتهى بلا خروجٍ مسجَّل): ما جرى فعلًا
    when p_entered_at is not null then
      case
        when p_left_at is not null and p_left_at > p_entered_at
          then tstzrange(p_entered_at, p_left_at, '[)')
        when p_left_at is null
          then tstzrange(p_entered_at, p_entered_at + make_interval(mins => coalesce(p_expected_minutes,
                 greatest(1, round(extract(epoch from (p_end - p_start)) / 60)::int))), '[)')
      end

    -- انتهى بلا دخول، أو حاضرٌ ينتظر ولم يدخل: لا يحجز وقتًا بعينه
    when p_status in ('completed', 'walk_in', 'waiting') then null

    when p_end > p_start then tstzrange(p_start, p_end, '[)')
  end;
$$;

comment on function app_appointment_busy_range(text, timestamptz, timestamptz, timestamptz, timestamptz, integer) is
  'الوقت الذي يشغله موعدٌ من الطبيب فعلًا — تقرؤه منع التداخل وشبكة الأوقات و«أقرب موعد» معًا.';

-- مواعيد الطبيب المشغولة في نافذة — داخليّة: تُقرأ الأسماء منها، فلا تُنادى
-- إلّا من دوالّ تفحص العضوية قبلها.
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
     and r.busy && tstzrange(p_from, p_to, '[)');
$$;

revoke all on function app_doctor_busy_ranges(uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) وصف التعارض — ما يحتاجه الموظّف ليقرّر
--
-- `null` إن كان الوقت فارغًا. وإلّا: من كم إلى كم، وهل المريض داخل، وأقرب
-- بدايةٍ تتّسع للمدّة **كاملة** — تتخطّى التعارضات المتلاحقة لا الأوّل وحده.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_doctor_overlap_info(
  p_organization_id uuid,
  p_doctor_id       uuid,
  p_start           timestamptz,
  p_end             timestamptz,
  p_exclude_id      uuid default null,
  p_with_names      boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_dur   interval;
  v_from  timestamptz;
  v_until timestamptz;
  v_in    boolean;
  v_conf  jsonb;
  v_next  timestamptz;
  v_max   timestamptz;
  v_i     int := 0;
begin
  if p_doctor_id is null or p_start is null or p_end is null or p_end <= p_start then
    return null;
  end if;
  v_dur := p_end - p_start;

  select min(lower(b.busy)),
         max(upper(b.busy)),
         bool_or(b.in_session),
         jsonb_agg(jsonb_build_object(
           'from',         lower(b.busy),
           'until',        upper(b.busy),
           'in_session',   b.in_session,
           'status',       b.status,
           'service_name', b.service_name,
           'patient_name', case when p_with_names then b.patient_name end
         ) order by lower(b.busy))
    into v_from, v_until, v_in, v_conf
    from app_doctor_busy_ranges(p_organization_id, p_doctor_id, p_exclude_id, p_start, p_end) b;

  if v_from is null then
    return null;
  end if;

  v_next := p_start;
  loop
    v_i := v_i + 1;
    select max(upper(b.busy)) into v_max
      from app_doctor_busy_ranges(p_organization_id, p_doctor_id, p_exclude_id, v_next, v_next + v_dur) b;
    exit when v_max is null or v_i > 60;
    v_next := v_max;
  end loop;

  return jsonb_build_object(
    'busy_from',        v_from,
    'busy_until',       v_until,
    'in_session',       coalesce(v_in, false),
    'next_free',        v_next,
    'duration_minutes', round(extract(epoch from v_dur) / 60)::int,
    'conflicts',        coalesce(v_conf, '[]'::jsonb)
  );
end;
$$;

revoke all on function app_doctor_overlap_info(uuid, uuid, timestamptz, timestamptz, uuid, boolean)
  from public, anon, authenticated;

-- الفحص المسبق للشاشة: يُظهر الوقت محجوبًا قبل الضغط على «حجز».
create or replace function app_check_appointment_overlap(
  p_organization_id uuid,
  p_doctor_id       uuid,
  p_start           timestamptz,
  p_end             timestamptz,
  p_exclude_id      uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not exists (select 1 from doctors
                  where id = p_doctor_id and organization_id = p_organization_id) then
    raise exception 'الطبيب لا ينتمي لهذه المنشأة';
  end if;
  return app_doctor_overlap_info(p_organization_id, p_doctor_id, p_start, p_end, p_exclude_id, true);
end;
$$;

revoke all on function app_check_appointment_overlap(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function app_check_appointment_overlap(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) المُحفِّز
--
-- **`security definer` الآن:** كان يعمل بصلاحيات من يحجز، فموظّف فرعٍ لا ترى
-- سياسته مواعيد الفرع الآخر لم يكن يرى تعارضه مع موعدٍ للطبيب نفسه هناك.
-- ═══════════════════════════════════════════════════════════════════════════
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
  if new.status in ('completed','no_show','cancelled_by_patient','cancelled_by_staff','waiting','walk_in') then
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
  before insert or update of organization_id, doctor_id, scheduled_start, scheduled_end, status
  on appointments for each row execute function app_prevent_appointment_overlap();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) شبكة الأوقات المتاحة — بالتعريف نفسه
--
-- منقولةٌ من 0082 كما هي، إلّا حساب المحجوز: كان بالموعد المكتوب، فخانةٌ
-- يشغلها مريضٌ دخل متأخّرًا تظهر فارغةً ثمّ يرفضها الحفظ. والخانة المحجوزة
-- تقول الآن حتى متى.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_doctor_available_slots(
  p_doctor_id uuid,
  p_date      date,
  p_clinic_id uuid default null,
  p_duration  int default null
)
returns table (
  slot_start timestamptz,
  slot_end   timestamptz,
  clinic_id  uuid,
  capacity   int,
  booked     int,
  is_free    boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from doctors where id = p_doctor_id;
  if v_org is null or not app_is_member(v_org) then
    return;
  end if;

  return query
  with ranges as (
    select * from app_doctor_working_ranges(p_doctor_id, p_date, p_clinic_id)
  ),
  slots as (
    select
      g.s as slot_start,
      g.s + make_interval(mins => coalesce(p_duration, r.slot_duration_minutes, 15)) as slot_end,
      r.clinic_id,
      r.capacity
    from ranges r
    cross join lateral generate_series(
      r.starts_at,
      r.ends_at - make_interval(mins => coalesce(p_duration, r.slot_duration_minutes, 15)),
      make_interval(mins => coalesce(p_duration, r.slot_duration_minutes, 15))
    ) g(s)
  )
  select
    s.slot_start,
    s.slot_end,
    s.clinic_id,
    s.capacity,
    coalesce(a.taken, 0)::int,
    coalesce(a.taken, 0) < s.capacity and bl.reason is null,
    coalesce(bl.reason,
             case when coalesce(a.taken, 0) >= s.capacity
                  then case when a.any_inside then 'المريض داخل — مشغول حتى ' else 'محجوز حتى ' end
                       || to_char(a.busy_until at time zone 'Asia/Riyadh', 'HH24:MI')
             end)
  from slots s
  left join lateral (
    select count(*)::int      as taken,
           max(upper(b.busy)) as busy_until,
           bool_or(b.in_session) as any_inside
      from app_doctor_busy_ranges(v_org, p_doctor_id, null, s.slot_start, s.slot_end) b
  ) a on true
  left join lateral (
    select case h.exception_type
             when 'leave'     then 'إجازة'
             when 'vacation'  then 'إجازة سنوية'
             when 'training'  then 'تدريب'
             when 'emergency' then 'طارئ'
             else 'محجوب'
           end as reason
      from doctor_working_hours h
     where h.doctor_id = p_doctor_id
       and h.is_blocked
       and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(s.slot_start, s.slot_end, '[)')
     limit 1
  ) bl on true
  order by s.slot_start;
end;
$$;

revoke all on function app_doctor_available_slots(uuid, date, uuid, int) from public, anon;
grant execute on function app_doctor_available_slots(uuid, date, uuid, int) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) «أقرب موعد» — بالتعريف نفسه (منقولةٌ من 0154 إلّا شرط الموعد القائم)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_next_available_slot(
  p_organization_id uuid,
  p_doctor_id uuid,
  p_duration_minutes integer default 30,
  p_from timestamptz default null,
  p_days_ahead integer default 14,
  p_step_minutes integer default 5
)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_from     timestamptz;
  v_until    timestamptz;
  v_duration interval;
  v_step     interval;
  v_slot     timestamptz;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not exists (select 1 from doctors d
                  where d.id = p_doctor_id and d.organization_id = p_organization_id) then
    raise exception 'الطبيب المحدَّد لا ينتمي لهذه المنشأة';
  end if;

  v_from     := coalesce(p_from, now());
  v_until    := v_from + make_interval(days => greatest(coalesce(p_days_ahead, 14), 1));
  v_duration := make_interval(mins => greatest(coalesce(p_duration_minutes, 30), 1));
  v_step     := make_interval(mins => greatest(coalesce(p_step_minutes, 5), 1));

  -- الخانات المرشَّحة: داخل فترة دوامٍ غير محجوبة، وتتّسع للمدّة كاملة
  select c.slot into v_slot
    from doctor_working_hours w
    cross join lateral generate_series(
      greatest(w.starts_at, v_from), w.ends_at - v_duration, v_step) as c(slot)
   where w.doctor_id = p_doctor_id
     and coalesce(w.is_blocked, false) = false
     and w.ends_at > v_from
     and w.starts_at < v_until
     and c.slot + v_duration <= v_until
     -- لا تتقاطع مع فترة حجب للطبيب نفسه
     and not exists (
       select 1 from doctor_working_hours b
        where b.doctor_id = p_doctor_id
          and b.is_blocked = true
          and b.starts_at < c.slot + v_duration
          and b.ends_at   > c.slot)
     -- ولا مع وقتٍ يشغله موعدٌ فعلًا — بالتعريف الذي يفحص به الحفظ
     and not exists (
       select 1 from app_doctor_busy_ranges(p_organization_id, p_doctor_id, null,
                                            c.slot, c.slot + v_duration))
   order by c.slot
   limit 1;

  return v_slot;
end;
$$;

comment on function app_next_available_slot(uuid, uuid, integer, timestamptz, integer, integer) is
  'أوّل خانة تتّسع للمدّة في دوام الطبيب بلا تقاطع مع حجبٍ أو وقتٍ مشغول فعلًا. تقترح ولا تحجز.';

revoke all on function app_next_available_slot(uuid, uuid, integer, timestamptz, integer, integer)
  from public, anon;
grant execute on function app_next_available_slot(uuid, uuid, integer, timestamptz, integer, integer)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- حرسٌ ختاميّ
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_src text;
begin
  select pg_get_functiondef('app_prevent_appointment_overlap'::regproc) into v_src;
  if position('ZC_APPOINTMENT_OVERLAP' in v_src) = 0 then
    raise exception 'المُحفِّز لم يُحدَّث';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_prevent_appointment_overlap'
                    and tgrelid = 'appointments'::regclass and not tgisinternal) then
    raise exception 'مُحفِّز منع التداخل غير موجود';
  end if;
  if has_function_privilege('anon', 'app_doctor_overlap_info(uuid, uuid, timestamptz, timestamptz, uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'app_doctor_busy_ranges(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute') then
    raise exception 'الدوالّ الداخلية مكشوفة — تقرأ أسماء المرضى بلا فحص عضوية';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- بعد التشغيل — تجربة بلا أثر (معاملةٌ تُلغى):
--
--   begin;
--   select app_doctor_overlap_info('<المنشأة>', '<الطبيب>',
--          now() + interval '1 hour', now() + interval '90 minutes', null, false);
--   rollback;
-- ---------------------------------------------------------------------------
