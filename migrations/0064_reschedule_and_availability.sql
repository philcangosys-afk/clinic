-- ---------------------------------------------------------------------------
-- 0064_reschedule_and_availability.sql — إعادة الجدولة وفحص توفّر الطبيب
-- ---------------------------------------------------------------------------
-- إعادة الجدولة كانت تحديثًا مباشرًا من الواجهة على `appointments`. ما ينقصه:
--
--   • **لا فحص لدوام الطبيب ولا لإجازته.** `doctor_working_hours` موجود منذ
--     0002 بعمود `is_blocked` يفرّق «متاح» عن «خارج الدوام»، ولا شيء في
--     القاعدة يقرؤه. و`leave_requests` موجود منذ 0020 ولا علاقة له بالحجز.
--     فيُحجز للطبيب في إجازته ولا يمنع النظام شيئًا.
--
--   • **لا سبب مسجَّل.** نقل موعد مريض من الثلاثاء إلى الخميس قرار يُسأل
--     عنه، وكان يقع بلا أثر.
--
--   • **لا قفل.** موظفان يسحبان الموعد نفسه في اللحظة نفسها ينتج عنهما آخر
--     كتابة تفوز بصمت.
--
-- **ولا يُكرَّر هنا منطق قائم:** منع التداخل يبقى في مُحفِّز
-- `app_prevent_appointment_overlap` (0050)، وإعادة توليد وظائف التذكير تبقى
-- في مُحفِّز `trg_schedule_appointment_reminders` (0050). الدالة تُحدِّث
-- الموعد فتشتغل المُحفِّزات من نفسها — نسخة ثانية من المنطق كانت ستنحرف عن
-- الأولى عند أول تعديل.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) فحص توفّر الطبيب
--
-- تُعيد النص فارغًا (NULL) إن كان متاحًا، وإلا **سبب المنع بالعربية**. سبب
-- ذلك: «غير متاح» وحدها تجعل الموظف يجرّب أوقاتًا عشوائية؛ «الطبيب في إجازة
-- حتى 12 سبتمبر» تُنهي الأمر.
--
-- قاعدة الدوام: إن لم تُسجَّل للطبيب أي فترة عمل، فهو متاح — النظام يعمل
-- اليوم بلا جداول دوام، وفرضُها فجأة كان سيمنع كل حجز في المنشأة. أما إن
-- سُجّلت فترات عمل، فالموعد يجب أن يقع **داخلها كاملًا**: موعد نصفه خارج
-- الدوام موعد خارج الدوام.
-- ---------------------------------------------------------------------------
create or replace function app_check_doctor_availability(
  p_doctor_id uuid,
  p_start     timestamptz,
  p_end       timestamptz
)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_doctor      doctors%rowtype;
  v_work_count  integer;
  v_uncovered   integer;
  v_leave_end   date;
begin
  select * into v_doctor from doctors where id = p_doctor_id;
  if v_doctor.id is null then
    return 'الطبيب غير موجود';
  end if;
  if not v_doctor.is_enabled then
    return 'الطبيب غير مفعَّل';
  end if;
  if v_doctor.disabled_from_booking then
    return 'الطبيب موقوف عن استقبال الحجوزات';
  end if;

  -- فترة منع صريحة تتقاطع مع الموعد
  if exists (
    select 1 from doctor_working_hours h
     where h.doctor_id = p_doctor_id
       and h.is_blocked
       and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
  ) then
    return 'الوقت المختار ضمن فترة عدم توفّر مسجَّلة للطبيب';
  end if;

  select count(*) into v_work_count
    from doctor_working_hours h
   where h.doctor_id = p_doctor_id and not h.is_blocked;

  if v_work_count > 0 then
    -- التغطية الكاملة: يُطرح اتحاد فترات العمل من مدى الموعد، فإن بقي شيء
    -- فالموعد يتجاوز الدوام. الطرح على المدى لا المقارنة بفترة واحدة، لأن
    -- الدوام قد يكون فترتين متلاصقتين (صباحية ومسائية) والموعد يعبر بينهما.
    select count(*) into v_uncovered
      from (
        select tstzmultirange(tstzrange(p_start, p_end, '[)'))
             - coalesce(
                 range_agg(tstzrange(h.starts_at, h.ends_at, '[)')),
                 tstzmultirange()
               ) as remaining
          from doctor_working_hours h
         where h.doctor_id = p_doctor_id
           and not h.is_blocked
           and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
      ) z
     where not isempty(z.remaining);

    if v_uncovered > 0 then
      return 'الوقت المختار خارج دوام الطبيب المسجَّل';
    end if;
  end if;

  -- الإجازة المعتمَدة: الطبيب موظَّف حين يرتبط `doctors.user_id` بسجل في
  -- `employees`. طبيب بلا سجل موظّف لا إجازات له، وهذا صحيح لا نقص.
  select l.end_date into v_leave_end
    from leave_requests l
    join employees e on e.id = l.employee_id
   where e.user_id = v_doctor.user_id
     and e.organization_id = v_doctor.organization_id
     and l.status = 'approved'
     and daterange(l.start_date, l.end_date, '[]')
         && daterange(p_start::date, p_end::date, '[]')
   order by l.end_date desc
   limit 1;

  if v_leave_end is not null then
    return format('الطبيب في إجازة معتمَدة حتى %s', to_char(v_leave_end, 'YYYY-MM-DD'));
  end if;

  return null;
end;
$$;

comment on function app_check_doctor_availability(uuid, timestamptz, timestamptz) is
  'يُعيد NULL إن كان الطبيب متاحًا في المدى، وإلا سبب المنع بالعربية (خارج الدوام، فترة منع، إجازة معتمَدة، موقوف عن الحجز).';

revoke all on function app_check_doctor_availability(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app_check_doctor_availability(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) إعادة الجدولة
-- ---------------------------------------------------------------------------
create or replace function app_reschedule_appointment(
  p_appointment_id  uuid,
  p_scheduled_start timestamptz,
  p_scheduled_end   timestamptz,
  p_doctor_id       uuid default null,
  p_clinic_id       uuid default null,
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old        appointments%rowtype;
  v_doctor     uuid;
  v_clinic     uuid;
  v_block      text;
  v_old_doctor text;
  v_new_doctor text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;

  -- القفل قبل أي فحص: بدونه يقرأ موظفان الحالة نفسها ثم يكتبان، فيفوز
  -- الأخير بصمت ويظن الأول أن نقله تمّ.
  select * into v_old from appointments where id = p_appointment_id for update;
  if v_old.id is null then
    raise exception 'الموعد غير موجود';
  end if;
  if not app_has_permission(v_old.organization_id, 'appointments.reschedule') then
    raise exception 'صلاحيتك لا تسمح بإعادة جدولة المواعيد';
  end if;
  if not app_can_access_branch(v_old.organization_id, v_old.branch_id) then
    raise exception 'الموعد يتبع فرعًا لا تملك الوصول إليه';
  end if;

  -- موعد انتهى أو أُلغي لا يُنقل: تصحيحه يكون بموعد جديد، وإلا اختفى من
  -- سجل التدقيق أن المريض لم يحضر يوم الثلاثاء أصلًا.
  if v_old.status in ('completed','no_show','cancelled_by_patient','cancelled_by_staff') then
    raise exception 'لا يمكن إعادة جدولة موعد حالته «%» — أنشئ موعدًا جديدًا', v_old.status;
  end if;
  if v_old.status in ('in_progress') then
    raise exception 'الزيارة جارية الآن — لا يمكن نقل الموعد';
  end if;

  if p_scheduled_end <= p_scheduled_start then
    raise exception 'وقت النهاية يجب أن يكون بعد وقت البداية';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب إعادة الجدولة مطلوب';
  end if;

  v_doctor := coalesce(p_doctor_id, v_old.doctor_id);
  v_clinic := coalesce(p_clinic_id, v_old.clinic_id);

  if not exists (select 1 from doctors where id = v_doctor and organization_id = v_old.organization_id) then
    raise exception 'الطبيب المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if v_clinic is not null and not exists (
       select 1 from clinics where id = v_clinic and organization_id = v_old.organization_id) then
    raise exception 'العيادة المحدَّدة لا تنتمي لهذه المنشأة';
  end if;

  v_block := app_check_doctor_availability(v_doctor, p_scheduled_start, p_scheduled_end);
  if v_block is not null then
    raise exception '%', v_block;
  end if;

  -- التحديث وحده: مُحفِّز 0050 يمنع التداخل، ومُحفِّز التذكيرات يُلغي
  -- الوظائف القديمة غير المرسَلة ويُنشئ غيرها على الموعد الجديد. لا نسخة
  -- ثانية من أيٍّ منهما هنا.
  update appointments
     set scheduled_start = p_scheduled_start,
         scheduled_end   = p_scheduled_end,
         doctor_id       = v_doctor,
         clinic_id       = v_clinic,
         updated_at      = now()
   where id = p_appointment_id;

  select name_ar into v_old_doctor from doctors where id = v_old.doctor_id;
  select name_ar into v_new_doctor from doctors where id = v_doctor;

  -- قيد تدقيق صريح بجانب القيد التلقائي: التلقائي يسجّل «تغيّر عمودان»،
  -- وهذا يسجّل **ما قبل وما بعد والسبب** في صف واحد مقروء.
  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, reason)
  values (
    v_old.organization_id, auth.uid(), 'update', 'appointments', p_appointment_id,
    format('إعادة جدولة موعد'),
    jsonb_build_object(
      'from', jsonb_build_object(
        'scheduled_start', v_old.scheduled_start,
        'scheduled_end',   v_old.scheduled_end,
        'doctor',          v_old_doctor,
        'clinic_id',       v_old.clinic_id
      ),
      'to', jsonb_build_object(
        'scheduled_start', p_scheduled_start,
        'scheduled_end',   p_scheduled_end,
        'doctor',          v_new_doctor,
        'clinic_id',       v_clinic
      )
    ),
    btrim(p_reason)
  );

  return jsonb_build_object(
    'appointment_id', p_appointment_id,
    'scheduled_start', p_scheduled_start,
    'scheduled_end',   p_scheduled_end,
    'doctor_id',       v_doctor,
    'clinic_id',       v_clinic
  );
end;
$$;

comment on function app_reschedule_appointment(uuid, timestamptz, timestamptz, uuid, uuid, text) is
  'نقل موعد إلى وقت/طبيب/عيادة أخرى داخل معاملة واحدة: قفل، صلاحية، فرع، حالة، توفّر الطبيب، ثم تحديث يُشغّل مُحفِّزَي منع التداخل وإعادة توليد التذكيرات. يكتب قيد تدقيق بالقديم والجديد والسبب.';

revoke all on function app_reschedule_appointment(uuid, timestamptz, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function app_reschedule_appointment(uuid, timestamptz, timestamptz, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) فحص التوفّر عند الإنشاء أيضًا
--
-- إعادة الجدولة وحدها لا تكفي: الحجز الأول هو الأكثر وقوعًا. مُحفِّز على
-- الإدخال يجعل القاعدة ترفض الحجز في الإجازة أيًّا كان المسار — كما فعلنا
-- مع الحظر.
--
-- المواعيد الحضورية (`walk_in`) و«الانتظار» مستثناة: المريض واقف أمام
-- الاستقبال فعلًا، ورفض تسجيله لأن الوقت خارج الدوام المسجَّل يمنع خدمة
-- قائمة بالفعل.
-- ---------------------------------------------------------------------------
create or replace function app_enforce_doctor_availability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_block text;
begin
  if new.status in ('walk_in','waiting') then
    return new;
  end if;
  v_block := app_check_doctor_availability(new.doctor_id, new.scheduled_start, new.scheduled_end);
  if v_block is not null then
    raise exception '%', v_block;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_doctor_availability on appointments;
create trigger trg_enforce_doctor_availability
before insert on appointments
for each row execute function app_enforce_doctor_availability();

commit;
