-- ============================================================================
-- 0210 — تنبيهات الطبيب الحيّة: مريضٌ أُرسل إليه، ملاحظة من الاستقبال،
--        اطّلاع الاستقبال على طلبه وتنفيذه، وقرار طلب الموعد، والإحالة إليه
-- ----------------------------------------------------------------------------
-- **لا شيء هنا يخصّ SMS ولا أيّ قناة خارجية** — تنبيهٌ داخل النظام فقط
-- (جدول notifications من 0103)، تقرؤه الواجهة كلّ بضع ثوانٍ وتُطلق معه صوتًا.
--
-- ما كان ناقصًا:
--   • الطبيب لا يُبلَّغ بشيء: الأحداث مسجّلة (طابور، ملاحظة، اطّلاع) ولا يصل
--     منها تنبيهٌ إلى بطاقته — كان عليه أن يحدّث شاشته بنفسه.
--   • شاشة «التنبيهات» مقفلة للطبيب في المنشأة لأن صفته المعدّلة (0201)
--     لا تحمل notifications.view — والتنبيه صندوقٌ شخصيّ يحتاجه كلّ عضو.
--
-- ما تفعله:
--   ١) تمنح notifications.view لكلّ صفة منشأة/دور مخصّص نشط ينقصه ذلك
--      (المنع الصريح لعضوٍ بعينه يبقى كما هو).
--   ٢) مُحفِّزات تكتب تنبيهًا لحساب الطبيب المربوط ببطاقته (doctors.user_id):
--        • مريض في انتظاره: أُرسل إليه من الاستقبال، أو وصل/سُجّل حضوره —
--          تنبيهٌ واحد للموعد مهما تعدّدت الخطوات (مفتاح منع التكرار).
--        • ملاحظة من الاستقبال على موعد مريضه (حقل الملاحظة في الطابور).
--        • اطّلع الاستقبال على طلبه / ملاحظته (مركز المتابعة)، ونُفِّذ طلبه.
--        • طلب موعد المتابعة الذي أرسله: اطُّلع عليه، حُجز، أو رُفض بسببه.
--        • إحالة مريضٍ إليه من طبيبٍ آخر.
--      لا تنبيه للطبيب عن فعلٍ فعله هو.
--   ٣) فشل كتابة التنبيه لا يُفشل العملية الأصلية أبدًا (حجز، إرسال، اطّلاع):
--      يُسجَّل تحذيرٌ ويمضي.
--
-- لا يمسّ الفواتير ولا ZATCA. آمنة للتكرار. كلّ جملة مستقلّة (محرّر Supabase).
-- ============================================================================

-- ── ١) شاشة التنبيهات لكلّ الأدوار ──────────────────────────────────────────
insert into organization_role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'notifications.view'
  from organization_roles r
 where r.is_active
   and not r.is_archived
   and exists (select 1 from permission_catalog c where c.permission_key = 'notifications.view')
   and not exists (select 1 from organization_role_permissions x
                    where x.role_id = r.id and x.permission_key = 'notifications.view');

-- ── ٢) حساب الطبيب من بطاقته (داخلية) ───────────────────────────────────────
create or replace function app_doctor_user_id(p_doctor_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.user_id from doctors d
   where d.id = p_doctor_id and coalesce(d.is_enabled, true);
$$;
revoke all on function app_doctor_user_id(uuid) from public, anon, authenticated;

-- اسم المريض «الاسم — ملف N»
create or replace function app_patient_label(p_patient_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.name_ar || coalesce(' — ملف ' || p.file_number::text, '')
    from patients p where p.id = p_patient_id;
$$;
revoke all on function app_patient_label(uuid) from public, anon, authenticated;

-- ── ٣) مريضٌ في انتظار الطبيب ───────────────────────────────────────────────
-- مؤجَّل إلى نهاية المعاملة: «إرسال للطبيب» يُدرج الموعد ثمّ يكتب المرسِل في
-- خطوة ثانية — فيُقرأ الموعد بحالته النهائية ويخرج تنبيهٌ واحد كامل.
create or replace function app_notify_doctor_patient_waiting()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a        appointments%rowtype;
  v_user   uuid;
  v_sender text;
  v_body   text;
begin
  begin
    select * into a from appointments where id = new.id;
    if a.id is null or a.doctor_id is null then
      return null;
    end if;
    if not (a.sent_by_user_id is not null
            or a.status in ('arrived', 'checked_in', 'waiting', 'walk_in')) then
      return null;
    end if;
    -- موعدٌ ليومٍ آخر لا يُنبَّه به (تصحيح سجلّ قديم مثلًا)
    if (a.scheduled_start at time zone 'Asia/Riyadh')::date
       <> (now() at time zone 'Asia/Riyadh')::date then
      return null;
    end if;

    v_user := app_doctor_user_id(a.doctor_id);
    if v_user is null or v_user = coalesce(a.sent_by_user_id, auth.uid()) then
      return null;
    end if;

    if a.sent_by_user_id is not null then
      v_sender := app_member_user_name(a.organization_id, a.sent_by_user_id);
    end if;

    v_body := concat_ws(' · ',
      app_patient_label(a.patient_id),
      case when a.queue_number is not null then 'رقم الدور ' || a.queue_number end,
      case when v_sender is not null then 'أرسله ' || v_sender end,
      case when a.priority in ('urgent', 'emergency') then 'عاجل' end,
      nullif(btrim(coalesce(a.note, '')), ''));

    perform app_notify(
      a.organization_id, v_user, 'patient_waiting_for_doctor',
      case when a.sent_by_user_id is not null then 'أُرسل إليك مريض' else 'وصل مريضك' end,
      'appt_waiting:' || a.id::text,
      v_body, 'clinical',
      case when a.priority in ('urgent', 'emergency') then 'warning' else 'info' end,
      'appointment', a.id, '/doctor-workspace', a.branch_id);
  exception when others then
    raise warning 'تنبيه الطبيب لم يُكتب (موعد %): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function app_notify_doctor_patient_waiting() from public, anon, authenticated;

drop trigger if exists trg_notify_doctor_patient_waiting on appointments;
create constraint trigger trg_notify_doctor_patient_waiting
  after insert or update of status, sent_by_user_id on appointments
  deferrable initially deferred
  for each row execute function app_notify_doctor_patient_waiting();

-- ── ٤) ملاحظة الاستقبال على موعد المريض ─────────────────────────────────────
create or replace function app_notify_doctor_appointment_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_note text := nullif(btrim(coalesce(new.note, '')), '');
begin
  begin
    if v_note is null or new.doctor_id is null
       or v_note is not distinct from nullif(btrim(coalesce(old.note, '')), '') then
      return null;
    end if;
    -- موعدٌ انتهى أو أُلغي لا تُرسَل عنه ملاحظة
    if new.status in ('completed', 'no_show', 'cancelled_by_patient', 'cancelled_by_staff') then
      return null;
    end if;
    v_user := app_doctor_user_id(new.doctor_id);
    if v_user is null or v_user = auth.uid() then
      return null;
    end if;

    perform app_notify(
      new.organization_id, v_user, 'reception_note_to_doctor',
      'ملاحظة من ' || coalesce(app_member_user_name(new.organization_id, auth.uid()), 'الاستقبال'),
      'appt_note:' || new.id::text || ':' || md5(v_note),
      concat_ws(' · ', app_patient_label(new.patient_id), left(v_note, 300)),
      'clinical', 'info', 'appointment', new.id, '/doctor-workspace', new.branch_id);
  exception when others then
    raise warning 'تنبيه الملاحظة لم يُكتب (موعد %): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function app_notify_doctor_appointment_note() from public, anon, authenticated;

drop trigger if exists trg_notify_doctor_appointment_note on appointments;
create trigger trg_notify_doctor_appointment_note
  after update of note on appointments
  for each row execute function app_notify_doctor_appointment_note();

-- ── ٥) طلب الطبيب إلى الاستقبال: اطُّلع عليه / نُفِّذ ──────────────────────
create or replace function app_notify_staff_request_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_what  text;
  v_actor uuid;
begin
  begin
    if new.requested_by is null then
      return null;
    end if;
    v_what := case new.request_type
                when 'call_patient'    then 'طلب استدعاء المريض'
                when 'collect_payment' then 'طلب التحصيل'
                else 'ملاحظتك' end;

    -- نُفِّذ (يُغني عن «اطُّلع» إن جاءا معًا)
    if new.status = 'done' and old.status is distinct from 'done' then
      v_actor := coalesce(new.resolved_by, auth.uid());
      if v_actor is distinct from new.requested_by then
        perform app_notify(
          new.organization_id, new.requested_by, 'staff_request_done',
          case new.request_type
            when 'call_patient'    then 'استُدعي المريض كما طلبت'
            when 'collect_payment' then 'حُصِّل المبلغ كما طلبت'
            else 'أُنجزت ملاحظتك' end
          || ' — ' || coalesce(app_member_user_name(new.organization_id, v_actor), 'الاستقبال'),
          'staff_done:' || new.id::text,
          concat_ws(' · ', app_patient_label(new.patient_id), left(nullif(btrim(coalesce(new.body, '')), ''), 120),
                    nullif(btrim(coalesce(new.resolution_note, '')), '')),
          'operational', 'info', 'staff_request', new.id, '/follow-up-center', new.branch_id);
      end if;
      return null;
    end if;

    if new.seen_at is not null and old.seen_at is null then
      v_actor := coalesce(new.seen_by, auth.uid());
      if v_actor is distinct from new.requested_by then
        perform app_notify(
          new.organization_id, new.requested_by, 'staff_request_seen',
          'اطّلع الاستقبال على ' || v_what || ' — ' || coalesce(app_member_user_name(new.organization_id, v_actor), ''),
          'staff_seen:' || new.id::text,
          concat_ws(' · ', app_patient_label(new.patient_id), left(nullif(btrim(coalesce(new.body, '')), ''), 120)),
          'operational', 'info', 'staff_request', new.id, '/follow-up-center', new.branch_id);
      end if;
    end if;
  exception when others then
    raise warning 'تنبيه الطلب لم يُكتب (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function app_notify_staff_request_progress() from public, anon, authenticated;

-- seen_at من 0173: يُنشأ المُحفِّز على العمودين إن وُجدا، وإلّا على الحالة وحدها
do $$
begin
  execute 'drop trigger if exists trg_notify_staff_request_progress on staff_requests';
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'staff_requests' and column_name = 'seen_at') then
    execute 'create trigger trg_notify_staff_request_progress
               after update of status, seen_at on staff_requests
               for each row execute function app_notify_staff_request_progress()';
  else
    execute 'create trigger trg_notify_staff_request_progress
               after update of status on staff_requests
               for each row execute function app_notify_staff_request_progress()';
  end if;
end $$;

-- ── ٦) طلبات المواعيد: إحالة إلى الطبيب، وقرار الاستقبال في طلبه ───────────
create or replace function app_notify_appointment_request_doctor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid;
  v_user   uuid;
  v_actor  text;
  v_when   text;
  v_from   text;
begin
  begin
    -- إحالة جديدة: للطبيب المُحال إليه
    if tg_op = 'INSERT' then
      if new.referred_by_doctor_id is not null and new.doctor_id is not null then
        v_user := app_doctor_user_id(new.doctor_id);
        if v_user is not null and v_user is distinct from auth.uid() then
          select name_ar into v_from from doctors where id = new.referred_by_doctor_id;
          perform app_notify(
            new.organization_id, v_user, 'doctor_referral_in',
            'إحالة مريض إليك من ' || coalesce(v_from, 'طبيب'),
            'referral_in:' || new.id::text,
            concat_ws(' · ', app_patient_label(new.patient_id), left(nullif(btrim(coalesce(new.reason, '')), ''), 160)),
            'clinical', 'info', 'appointment_request', new.id, '/doctor-workspace', new.branch_id);
        end if;
      end if;
      return null;
    end if;

    -- قرارات الاستقبال: لصاحب الطلب من الأطباء
    v_doctor := coalesce(new.referred_by_doctor_id,
                         case when new.source in ('doctor', 'doctor_followup') then new.doctor_id end);
    if v_doctor is null then
      return null;
    end if;
    v_user := app_doctor_user_id(v_doctor);
    if v_user is null or v_user = auth.uid() then
      return null;
    end if;
    v_actor := coalesce(app_member_user_name(new.organization_id, coalesce(new.decided_by, auth.uid())), 'الاستقبال');

    if new.status = 'approved' and old.status is distinct from 'approved' then
      select to_char(a.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') into v_when
        from appointments a where a.id = new.appointment_id;
      perform app_notify(
        new.organization_id, v_user, 'appointment_request_approved',
        'حُجز الموعد الذي طلبته — ' || v_actor,
        'appt_req_approved:' || new.id::text,
        concat_ws(' · ', app_patient_label(new.patient_id), case when v_when is not null then 'الموعد ' || v_when end),
        'operational', 'info', 'appointment_request', new.id, '/follow-up-center', new.branch_id);
    elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
      perform app_notify(
        new.organization_id, v_user, 'appointment_request_rejected',
        'لم يُحجز الموعد الذي طلبته — ' || v_actor,
        'appt_req_rejected:' || new.id::text,
        concat_ws(' · ', app_patient_label(new.patient_id), nullif(btrim(coalesce(new.decision_note, '')), '')),
        'operational', 'warning', 'appointment_request', new.id, '/follow-up-center', new.branch_id);
    elsif to_jsonb(new) ? 'seen_at'
          and (to_jsonb(new)->>'seen_at') is not null and (to_jsonb(old)->>'seen_at') is null
          and new.status = 'pending' then
      perform app_notify(
        new.organization_id, v_user, 'appointment_request_seen',
        'اطّلع الاستقبال على طلب الموعد — ' || v_actor,
        'appt_req_seen:' || new.id::text,
        app_patient_label(new.patient_id),
        'operational', 'info', 'appointment_request', new.id, '/follow-up-center', new.branch_id);
    end if;
  exception when others then
    raise warning 'تنبيه طلب الموعد لم يُكتب (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function app_notify_appointment_request_doctor() from public, anon, authenticated;

drop trigger if exists trg_notify_appointment_request_doctor on appointment_requests;
create trigger trg_notify_appointment_request_doctor
  after insert or update on appointment_requests
  for each row execute function app_notify_appointment_request_doctor();

-- ── النتيجة: الأطباء وحالة ربط حساباتهم (من لا حساب له لا يصله تنبيه) ──────
select d.name_ar                                             as "الطبيب",
       case when d.user_id is null then 'غير مربوط — اربطه من «الأطباء» ← حساب الدخول'
            else coalesce(app_member_user_name(d.organization_id, d.user_id), 'مربوط') end
                                                             as "حساب الدخول",
       case when d.user_id is null then '—'
            when not exists (select 1 from organization_memberships m
                              where m.organization_id = d.organization_id and m.user_id = d.user_id
                                and m.is_active)
            then 'لا — الحساب ليس عضوًا نشطًا في المنشأة'
            when exists (select 1 from v_user_effective_permissions e
                          where e.organization_id = d.organization_id and e.user_id = d.user_id
                            and e.permission_key = 'notifications.view' and e.is_allowed)
            then 'نعم' else 'لا — ممنوع صراحةً لهذا المستخدم' end           as "يفتح التنبيهات"
  from doctors d
 where coalesce(d.is_enabled, true)
 order by (d.user_id is null), d.name_ar;
