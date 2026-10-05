-- ============================================================================
-- 0231_flexible_monthly_schedules.sql — جدول الدوام مرن، ونمط شهري
-- ============================================================================
-- طلب المالك (05/10/2026): «عندما أعمل فترة نفس الفترة يقول: تتداخل هذه
-- الفترة مع فترة أخرى لنفس الطبيب (P0001) — نريد فترات الدوام مرنة، ونريد
-- إضافة بالشهر أيضًا بعد الأسبوع».
--
-- ١) **الأحدث يحلّ محلّ الأقدم بدل الرفض.** كان المُحفِّز يرفض أيّ فترةٍ تتقاطع
--    مع فترةٍ قائمة (اليوم نفسه، الوقت، السريان)، فلا يُغيَّر دوام طبيبٍ إلّا
--    بحذف القديم أوّلًا. الآن تُضبط الفترة القديمة تلقائيًّا:
--      • بدأت قبل الجديدة ⇐ تنتهي في اليوم السابق لسريان الجديدة (ويُبقى
--        باقيها بعد نهاية الجديدة، إن كان للجديدة نهاية، فترةً مستقلّة)؛
--      • بدأت معها أو بعدها وتغطّيها الجديدة ⇐ تُوقَف (is_active = false)؛
--      • بدأت معها أو بعدها وتمتدّ بعد نهاية الجديدة ⇐ تبدأ بعد نهايتها.
--    لا يُحذف شيء: القديم يبقى في الجدول بسريانه المعدَّل أو موقوفًا.
--    والتداخل يُقاس بين فترتين من **النمط نفسه** واليوم نفسه والعيادة نفسها.
--
-- ٢) **نمطٌ شهريّ:** `recurrence_type = 'monthly'` و`day_of_month` (1–31) —
--    «يوم 15 من كلّ شهر». الشهر الذي لا يومَ فيه بذلك الرقم (31 في أبريل)
--    لا دوام فيه بهذه الفترة.
--
-- يُرقَّع نصّ `app_doctor_working_ranges` الحيّ لا نصّ الملف، وتفشل الترقية
-- صراحةً إن لم يطابق النمط. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

lock table public.doctor_schedules in share row exclusive mode;

-- ── ١) عمود يوم الشهر، ويوم الأسبوع لا يلزم إلّا للأسبوعي ──────────────────
alter table public.doctor_schedules
  add column if not exists day_of_month smallint;

alter table public.doctor_schedules
  alter column day_of_week drop not null;

alter table public.doctor_schedules
  drop constraint if exists doctor_schedules_day_of_month_check;
alter table public.doctor_schedules
  add constraint doctor_schedules_day_of_month_check
  check (day_of_month is null or day_of_month between 1 and 31);

alter table public.doctor_schedules
  drop constraint if exists doctor_schedules_recurrence_check;
alter table public.doctor_schedules
  add constraint doctor_schedules_recurrence_check
  check (
    (recurrence_type = 'weekly' and day_of_week is not null)
    or (recurrence_type = 'alternate_days' and pattern_anchor_date is not null)
    or (recurrence_type = 'monthly' and day_of_month is not null)
  );

comment on column public.doctor_schedules.day_of_month is
  'النمط الشهري (0231): يوم الشهر 1–31 الذي تتكرّر فيه الفترة.';

-- ── ٢) التداخل: الأحدث يحلّ محلّ الأقدم ─────────────────────────────────────
create or replace function public.app_enforce_schedule_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.doctor_schedules%rowtype;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- التعديلات التي يُجريها هذا المُحفِّز نفسه على الفترات الأخرى لا تُعالَج ثانيةً
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if not coalesce(new.is_active, true) then
    return new;
  end if;
  if new.effective_to is not null and new.effective_to < new.effective_from then
    raise exception 'تاريخ «حتى» قبل تاريخ «يسري من»';
  end if;

  for r in
    select s.*
      from public.doctor_schedules s
     where s.doctor_id = new.doctor_id
       and s.is_active
       and s.id <> new.id
       and s.recurrence_type = new.recurrence_type
       and case new.recurrence_type
             when 'weekly'  then s.day_of_week = new.day_of_week
             when 'monthly' then s.day_of_month = new.day_of_month
             when 'alternate_days' then mod(abs(s.pattern_anchor_date - new.pattern_anchor_date), 2) = 0
             else false
           end
       and coalesce(s.clinic_id, v_zero) = coalesce(new.clinic_id, v_zero)
       and daterange(s.effective_from, s.effective_to, '[]')
           && daterange(new.effective_from, new.effective_to, '[]')
       and (s.start_time, s.end_time) overlaps (new.start_time, new.end_time)
     for update
  loop
    if r.effective_from < new.effective_from then
      -- ما بعد نهاية الجديدة يبقى للقديمة فترةً مستقلّة
      if new.effective_to is not null and (r.effective_to is null or r.effective_to > new.effective_to) then
        insert into public.doctor_schedules
        select (jsonb_populate_record(
                  null::public.doctor_schedules,
                  to_jsonb(r) || jsonb_build_object(
                    'id', gen_random_uuid(),
                    'effective_from', new.effective_to + 1,
                    'effective_to', r.effective_to,
                    'created_at', now(),
                    'updated_at', now()))).*;
      end if;
      update public.doctor_schedules
         set effective_to = new.effective_from - 1, updated_at = now()
       where id = r.id;
    elsif new.effective_to is null or (r.effective_to is not null and r.effective_to <= new.effective_to) then
      update public.doctor_schedules
         set is_active = false, updated_at = now()
       where id = r.id;
    else
      update public.doctor_schedules
         set effective_from = new.effective_to + 1, updated_at = now()
       where id = r.id;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_schedule_overlap on public.doctor_schedules;
create trigger trg_schedule_overlap
  before insert or update on public.doctor_schedules
  for each row execute function public.app_enforce_schedule_overlap();

-- ── ٣) ساعات العمل تقرأ النمط الشهري ────────────────────────────────────────
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef('public.app_doctor_working_ranges(uuid,date,uuid)'::regprocedure) into v_src;
  v_src := replace(v_src, chr(13), '');

  if position('''monthly''' in v_src) > 0 then
    raise notice 'app_doctor_working_ranges تقرأ النمط الشهري سلفًا — لا تغيير';
    return;
  end if;

  v_new := regexp_replace(v_src,
    '\(s\.recurrence_type = ''weekly'' and s\.day_of_week = extract\(isodow from p_date\)::int\)',
    '(s.recurrence_type = ''weekly'' and s.day_of_week = extract(isodow from p_date)::int)'
      || E'\n         or (s.recurrence_type = ''monthly'' and s.day_of_month = extract(day from p_date)::int)');
  if v_new = v_src then
    raise exception 'تعذّر ترقيع app_doctor_working_ranges — تغيّر نصّها';
  end if;
  execute v_new;
end $$;

commit;

notify pgrst, 'reload schema';

select 'الدوام الشهري' as "البند",
       case when pg_get_functiondef('public.app_doctor_working_ranges(uuid,date,uuid)'::regprocedure) like '%''monthly''%'
            then 'جاهزة' else 'مفقودة' end as "الحالة"
union all
select 'الفترة الأحدث تحلّ محلّ الأقدم',
       case when pg_get_functiondef('public.app_enforce_schedule_overlap()'::regprocedure) like '%pg_trigger_depth%'
            then 'جاهزة' else 'مفقودة' end;
