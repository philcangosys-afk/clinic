-- ---------------------------------------------------------------------------
-- 0065_reception_board.sql — لوحة الاستقبال: ترتيب، تنبيهات، نقل، تراجع
-- ---------------------------------------------------------------------------
-- شاشة الاستقبال كانت قائمة مواعيد يرتّبها المتصفح. ثلاثة نقائص:
--
--   • **الترتيب في العميل.** كل موظف يرى ترتيبًا قد يختلف عن زميله بحسب ما
--     وصله من صفحات، ولا يمكن لتقرير أن يُعيد إنتاج «من كان التالي». الترتيب
--     قرار تشغيلي — موضعه القاعدة.
--
--   • **لا مدّة انتظار.** الأعمدة الزمنية موجودة منذ 0002
--     (`checked_in_1_at` و`called_at` و`entered_at`) ولا شيء يحسب الفروق
--     بينها، فلا يعرف الموظف من ينتظر منذ خمس دقائق ومن منذ ساعة.
--
--   • **لا نقل ولا تراجع.** طبيب تأخّر أو عيادة تعطّلت: لا سبيل إلا تعديل
--     الموعد يدويًا بلا سبب ولا أثر. وانتقال خاطئ (نداء مريض غير المقصود)
--     لا رجعة فيه.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) إعدادات الاستقبال
--
-- عتبتان لا واحدة: «متأخر» و«متأخر جدًا» حالتان مختلفتان في التصرّف — الأولى
-- تستدعي اعتذارًا، والثانية تستدعي تدخّل المشرف.
-- ---------------------------------------------------------------------------
create table if not exists reception_settings (
  organization_id          uuid primary key references organizations(id) on delete cascade,
  waiting_warning_minutes  integer not null default 20 check (waiting_warning_minutes > 0),
  waiting_critical_minutes integer not null default 40 check (waiting_critical_minutes > 0),
  -- تذكرة الدور: تُطبع أو لا، وبرمز استعلام أو بدونه
  print_queue_ticket       boolean not null default true,
  ticket_show_qr           boolean not null default false,
  updated_at               timestamptz not null default now(),
  constraint reception_settings_thresholds_check
    check (waiting_critical_minutes > waiting_warning_minutes)
);

alter table reception_settings enable row level security;
drop policy if exists "reception_settings_read" on reception_settings;
create policy "reception_settings_read" on reception_settings
  for select using (app_is_member(organization_id));
drop policy if exists "reception_settings_write" on reception_settings;
create policy "reception_settings_write" on reception_settings
  for all using (app_is_org_admin(organization_id)) with check (app_is_org_admin(organization_id));
revoke all on reception_settings from anon;
grant select, insert, update on reception_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2) منظور الطابور — الترتيب هنا لا في المتصفح
--
-- مدّة الانتظار تُحسب من **وقت الوصول** لا من إنشاء الموعد: مريض حجز قبل
-- شهر لم ينتظر شهرًا. وتتوقّف عند النداء: ما بعده انتظار الطبيب لا انتظار
-- الاستقبال، وخلطهما يجعل كل الأرقام بلا معنى.
-- ---------------------------------------------------------------------------
create or replace view v_reception_queue as
select
  a.id                       as appointment_id,
  a.organization_id,
  a.branch_id,
  a.queue_number,
  a.status,
  a.priority,
  a.scheduled_start,
  a.checked_in_1_at          as arrived_at,
  a.checked_in_2_at          as checked_in_at,
  a.called_at,
  a.entered_at,
  a.left_at,
  a.note,
  p.id                       as patient_id,
  p.name_ar                  as patient_name,
  p.file_number,
  p.mobile_number,
  p.blood_type,
  p.insurance_company_name,
  (p.insurance_company_name is not null
     and (p.insurance_membership_expiry is null
          or p.insurance_membership_expiry >= current_date))            as insurance_valid,
  d.id                       as doctor_id,
  d.name_ar                  as doctor_name,
  c.id                       as clinic_id,
  c.name                     as clinic_name,

  -- تنبيه طبي مختصر مسموح للاستقبال: أسماء الحالات المؤشَّرة فقط، بلا
  -- تفاصيل سريرية. الاستقبال يحتاج أن يعرف «سكري» ليقدّمه في الطابور، ولا
  -- يحتاج قراءة سجله.
  (select string_agg(h.name_ar, '، ' order by h.sort_order)
     from patient_health_conditions phc
     join health_conditions h on h.id = phc.condition_id
    where phc.patient_id = p.id and phc.is_checked)                     as medical_alert,

  -- الانتظار: من الوصول إلى النداء، أو إلى الآن إن لم يُنادَ بعد.
  case
    when a.checked_in_1_at is null then null
    else floor(extract(epoch from (coalesce(a.called_at, now()) - a.checked_in_1_at)) / 60)::integer
  end                                                                   as waiting_minutes,

  -- الفاتورة: أحدث فاتورة بيع لهذا الموعد ومتبقّيها.
  inv.invoice_id,
  inv.invoice_status,
  inv.remaining_amount
from appointments a
join patients p on p.id = a.patient_id
join doctors  d on d.id = a.doctor_id
left join clinics c on c.id = a.clinic_id
left join lateral (
  select s.id as invoice_id, s.status as invoice_status, s.remaining_amount
    from sales_invoices s
   where s.appointment_id = a.id and s.invoice_type = 'sale'
   order by s.created_at desc
   limit 1
) inv on true
where a.status in ('confirmed','arrived','checked_in','called','in_progress','walk_in','waiting');

alter view v_reception_queue set (security_invoker = on);
revoke all on v_reception_queue from anon;
grant select on v_reception_queue to authenticated;

-- ---------------------------------------------------------------------------
-- 3) دالة الترتيب — رقم واحد يُرتَّب به
--
-- الترتيب المطلوب: طارئ ← عاجل ← كبار السن وذوو الإعاقة ← وقت الوصول ← وقت
-- الموعد. يُعبَّر عنه برتبة عددية لتُستعمل في `order by` واحد، فلا يُعاد
-- تعريف الترتيب في كل استعلام.
-- ---------------------------------------------------------------------------
create or replace function app_queue_rank(p_priority text)
returns integer
language sql
immutable
as $$
  select case p_priority
    when 'emergency'     then 1
    when 'urgent'        then 2
    when 'elderly'       then 3
    when 'accessibility' then 3
    else 4
  end;
$$;

create or replace view v_reception_queue_ordered as
select q.*,
       app_queue_rank(q.priority) as priority_rank,
       coalesce(rs.waiting_warning_minutes, 20)  as warning_minutes,
       coalesce(rs.waiting_critical_minutes, 40) as critical_minutes,
       case
         when q.waiting_minutes is null then 'none'
         when q.waiting_minutes >= coalesce(rs.waiting_critical_minutes, 40) then 'critical'
         when q.waiting_minutes >= coalesce(rs.waiting_warning_minutes, 20)  then 'warning'
         else 'ok'
       end as waiting_state
from v_reception_queue q
left join reception_settings rs on rs.organization_id = q.organization_id
order by
  app_queue_rank(q.priority),
  q.arrived_at nulls last,
  q.scheduled_start;

alter view v_reception_queue_ordered set (security_invoker = on);
revoke all on v_reception_queue_ordered from anon;
grant select on v_reception_queue_ordered to authenticated;

-- ---------------------------------------------------------------------------
-- 4) إجراءات الاستقبال — تُضاف إلى الدالة القائمة لا تُستبدل بمسار جديد
--
-- تُعاد كتابة `app_reception_transition` بإضافة `recall` و`uncall` و`undo`،
-- وبفحص **الصلاحية** (0062) بدل فحص الصفة وحدها. بقية المنطق كما استقرّ في
-- 0055 — بما فيه الإصلاح الذي جعل «بدء الزيارة» يعمل أصلًا.
-- ---------------------------------------------------------------------------
create or replace function app_reception_transition(
  p_appointment_id uuid,
  p_action text,
  p_reason text default null
)
returns table (appointment_id uuid, appointment_status text, visit_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v             appointments%rowtype;
  v_visit_id    uuid;
  v_next_status text;
  v_queue       integer;
  v_perm        text;
begin
  select * into v from appointments where id = p_appointment_id for update;
  if v.id is null then
    raise exception 'الموعد غير موجود';
  end if;
  if not app_can_access_branch(v.organization_id, v.branch_id) then
    raise exception 'الموعد يتبع فرعًا لا تملك الوصول إليه';
  end if;

  -- الصلاحية بحسب الإجراء لا صفة واحدة لكل شيء: الممرّض ينادي ولا يبدأ
  -- الزيارة، والطبيب يبدأ ولا يعيد الجدولة.
  v_perm := case p_action
    when 'confirm'  then 'appointments.update'
    when 'arrive'   then 'reception.check_in'
    when 'check_in' then 'reception.check_in'
    when 'call'     then 'reception.call'
    when 'recall'   then 'reception.call'
    when 'uncall'   then 'reception.call'
    when 'start'    then 'reception.start_visit'
    when 'finish'   then 'reception.finish'
    when 'no_show'  then 'reception.check_in'
    when 'undo'     then 'reception.override'
    else null
  end;
  if v_perm is null then
    raise exception 'الإجراء % غير معروف', p_action;
  end if;
  if not app_has_permission(v.organization_id, v_perm) then
    raise exception 'صلاحيتك لا تسمح بهذا الإجراء';
  end if;

  if p_action = 'confirm' and v.status in ('new','scheduled','unconfirmed') then
    update appointments set status = 'confirmed', updated_at = now() where id = v.id;
    v_next_status := 'confirmed';

  elsif p_action = 'arrive' and v.status in ('new','scheduled','confirmed','unconfirmed') then
    -- رقم الدور يُمنح مرة واحدة: إعادة تسجيل الوصول لا تُقدّم المريض على من سبقه.
    if v.queue_number is null then
      select coalesce(max(a.queue_number), 0) + 1 into v_queue
        from appointments a
       where a.organization_id = v.organization_id
         and a.scheduled_start::date = v.scheduled_start::date;
    else
      v_queue := v.queue_number;
    end if;
    update appointments
       set status = 'arrived',
           checked_in_1_at = coalesce(checked_in_1_at, now()),
           queue_number = v_queue,
           updated_at = now()
     where id = v.id;
    v_next_status := 'arrived';

  elsif p_action = 'check_in' and v.status = 'arrived' then
    update appointments
       set status = 'checked_in', checked_in_2_at = coalesce(checked_in_2_at, now()), updated_at = now()
     where id = v.id;
    v_next_status := 'checked_in';

  elsif p_action = 'call' and v.status in ('arrived','checked_in','waiting','walk_in') then
    update appointments
       set status = 'called', called_at = coalesce(called_at, now()), updated_at = now()
     where id = v.id;
    v_next_status := 'called';

  -- (جديد) إعادة النداء: الحالة لا تتغيّر، ووقت النداء **لا يُعاد ضبطه**.
  -- إعادته كانت ستُصفّر مدّة انتظار المريض في كل نداء، فيبدو من انتظر ساعة
  -- كمن وصل للتوّ — وهو ما تُقاس عليه تقارير الانتظار.
  elsif p_action = 'recall' and v.status = 'called' then
    update appointments set updated_at = now() where id = v.id;
    v_next_status := 'called';

  -- (جديد) إلغاء النداء: نودي الخطأ، فيعود إلى الطابور بوقت وصوله الأصلي.
  elsif p_action = 'uncall' and v.status = 'called' then
    update appointments
       set status = case when v.checked_in_2_at is not null then 'checked_in' else 'arrived' end,
           called_at = null,
           updated_at = now()
     where id = v.id;
    v_next_status := case when v.checked_in_2_at is not null then 'checked_in' else 'arrived' end;

  elsif p_action = 'start' and v.status in ('called','checked_in','waiting','walk_in','arrived') then
    update appointments
       set status = 'in_progress', entered_at = coalesce(entered_at, now()), updated_at = now()
     where id = v.id;

    select pv.id into v_visit_id from patient_visits pv where pv.appointment_id = v.id;
    if v_visit_id is null then
      insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id, appointment_id, created_by)
      values (v.organization_id, v.patient_id, v.doctor_id, v.clinic_id, v.id, auth.uid())
      returning id into v_visit_id;
    else
      update patient_visits pv
         set doctor_id = v.doctor_id, clinic_id = v.clinic_id, updated_at = now()
       where pv.id = v_visit_id;
    end if;
    v_next_status := 'in_progress';

  elsif p_action = 'finish' and v.status = 'in_progress' then
    update appointments
       set status = 'completed', left_at = coalesce(left_at, now()), updated_at = now()
     where id = v.id;
    select pv.id into v_visit_id from patient_visits pv where pv.appointment_id = v.id;
    v_next_status := 'completed';

  elsif p_action = 'no_show' and v.status in ('new','scheduled','confirmed','unconfirmed','arrived') then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'سبب عدم الحضور مطلوب';
    end if;
    update appointments
       set status = 'no_show', no_show_reason = btrim(p_reason), updated_at = now()
     where id = v.id;
    v_next_status := 'no_show';

  -- (جديد) التراجع عن انتقال خاطئ — بصلاحية `reception.override` وحدها.
  --
  -- خطوة واحدة إلى الوراء لا رجوع حرّ: التراجع عن «مكتمل» يعيد فتح زيارة
  -- ربما صدرت بها فاتورة، فيُمنع. والسبب إلزامي لأن التراجع نفسه حدث يُدقَّق.
  elsif p_action = 'undo' then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'سبب التراجع مطلوب';
    end if;
    if v.status = 'called' then
      update appointments
         set status = case when v.checked_in_2_at is not null then 'checked_in' else 'arrived' end,
             called_at = null, updated_at = now()
       where id = v.id;
      v_next_status := case when v.checked_in_2_at is not null then 'checked_in' else 'arrived' end;
    elsif v.status = 'checked_in' then
      update appointments set status = 'arrived', checked_in_2_at = null, updated_at = now() where id = v.id;
      v_next_status := 'arrived';
    elsif v.status = 'arrived' then
      update appointments
         set status = 'confirmed', checked_in_1_at = null, queue_number = null, updated_at = now()
       where id = v.id;
      v_next_status := 'confirmed';
    elsif v.status = 'no_show' then
      update appointments set status = 'confirmed', no_show_reason = null, updated_at = now() where id = v.id;
      v_next_status := 'confirmed';
    else
      raise exception 'لا يمكن التراجع عن الحالة «%» — الحالات المكتملة والجارية تُصحَّح بإجراء صريح لا بالتراجع', v.status;
    end if;

    insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, reason)
    values (v.organization_id, auth.uid(), 'update', 'appointments', v.id, 'تراجع عن انتقال',
            jsonb_build_object('from', v.status, 'to', v_next_status)::text, btrim(p_reason));

  else
    raise exception 'الإجراء % غير مسموح للحالة %', p_action, v.status;
  end if;

  return query select v.id, v_next_status, v_visit_id;
end;
$$;

revoke all on function app_reception_transition(uuid, text, text) from public, anon;
grant execute on function app_reception_transition(uuid, text, text) to authenticated;

-- خريطة الانتقالات تشمل الرجوع الآن، وإلا رفض المُحفِّز ما تسمح به الدالة.
create or replace function app_validate_appointment_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'new'          then array['scheduled','confirmed','unconfirmed','arrived','no_show','cancelled_by_patient','cancelled_by_staff']
    when 'scheduled'    then array['confirmed','unconfirmed','arrived','no_show','cancelled_by_patient','cancelled_by_staff']
    when 'unconfirmed'  then array['scheduled','confirmed','arrived','no_show','cancelled_by_patient','cancelled_by_staff']
    when 'confirmed'    then array['arrived','no_show','cancelled_by_patient','cancelled_by_staff','scheduled']
    when 'walk_in'      then array['waiting','called','in_progress','completed','no_show','cancelled_by_staff']
    when 'waiting'      then array['called','in_progress','completed','no_show','cancelled_by_staff']
    -- الرجوع خطوةً واحدة مسموح (التراجع عن خطأ)، والقفز إلى الأمام ممنوع.
    when 'arrived'      then array['checked_in','called','in_progress','no_show','cancelled_by_staff','confirmed']
    when 'checked_in'   then array['called','in_progress','cancelled_by_staff','arrived']
    when 'called'       then array['in_progress','no_show','checked_in','cancelled_by_staff','arrived']
    when 'in_progress'  then array['completed','cancelled_by_staff']
    when 'no_show'      then array['confirmed']
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'انتقال حالة الموعد غير مسموح: % إلى %', old.status, new.status;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) النقل بين طبيب أو عيادة
-- ---------------------------------------------------------------------------
create or replace function app_transfer_reception_appointment(
  p_appointment_id uuid,
  p_doctor_id      uuid default null,
  p_clinic_id      uuid default null,
  p_reason         text default null
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
  v_queue      integer;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;

  select * into v_old from appointments where id = p_appointment_id for update;
  if v_old.id is null then
    raise exception 'الموعد غير موجود';
  end if;
  if not app_has_permission(v_old.organization_id, 'reception.transfer') then
    raise exception 'صلاحيتك لا تسمح بنقل المرضى بين الأطباء أو العيادات';
  end if;
  if not app_can_access_branch(v_old.organization_id, v_old.branch_id) then
    raise exception 'الموعد يتبع فرعًا لا تملك الوصول إليه';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب النقل مطلوب';
  end if;
  if v_old.status not in ('confirmed','arrived','checked_in','called','waiting','walk_in') then
    raise exception 'لا يمكن النقل في الحالة «%»', v_old.status;
  end if;

  v_doctor := coalesce(p_doctor_id, v_old.doctor_id);
  v_clinic := coalesce(p_clinic_id, v_old.clinic_id);
  if v_doctor = v_old.doctor_id and v_clinic is not distinct from v_old.clinic_id then
    raise exception 'لم يتغيّر شيء — اختر طبيبًا أو عيادة مختلفة';
  end if;

  if not exists (select 1 from doctors where id = v_doctor and organization_id = v_old.organization_id) then
    raise exception 'الطبيب المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if v_clinic is not null and not exists (
       select 1 from clinics where id = v_clinic and organization_id = v_old.organization_id) then
    raise exception 'العيادة المحدَّدة لا تنتمي لهذه المنشأة';
  end if;

  -- الطبيب الجديد يجب أن يكون متاحًا فعلًا: النقل إلى طبيب في إجازة ينقل
  -- المشكلة ولا يحلّها.
  if v_doctor <> v_old.doctor_id then
    v_block := app_check_doctor_availability(v_doctor, v_old.scheduled_start, v_old.scheduled_end);
    if v_block is not null then
      raise exception '%', v_block;
    end if;
  end if;

  -- رقم الدور يُعاد حسابه فقط إن لم يكن للمريض رقم بعد. من وصل ووقف في
  -- الطابور لا يفقد دوره لأن الطبيب تغيّر — الذنب ليس ذنبه.
  v_queue := v_old.queue_number;
  if v_queue is null and v_old.status in ('arrived','checked_in','called') then
    select coalesce(max(a.queue_number), 0) + 1 into v_queue
      from appointments a
     where a.organization_id = v_old.organization_id
       and a.scheduled_start::date = v_old.scheduled_start::date;
  end if;

  update appointments
     set doctor_id = v_doctor,
         clinic_id = v_clinic,
         queue_number = v_queue,
         updated_at = now()
   where id = p_appointment_id;

  -- الزيارة إن كانت قد فُتحت تتبع الطبيب الجديد أيضًا، وإلا وقّع الطبيب
  -- الأول على فحص أجراه الثاني.
  update patient_visits
     set doctor_id = v_doctor, clinic_id = v_clinic, updated_at = now()
   where appointment_id = p_appointment_id;

  select name_ar into v_old_doctor from doctors where id = v_old.doctor_id;
  select name_ar into v_new_doctor from doctors where id = v_doctor;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, reason)
  values (
    v_old.organization_id, auth.uid(), 'update', 'appointments', p_appointment_id, 'نقل بين طبيب/عيادة',
    jsonb_build_object(
      'from', jsonb_build_object('doctor', v_old_doctor, 'clinic_id', v_old.clinic_id),
      'to',   jsonb_build_object('doctor', v_new_doctor, 'clinic_id', v_clinic)
    )::text,
    btrim(p_reason)
  );

  return jsonb_build_object('appointment_id', p_appointment_id, 'doctor_id', v_doctor, 'clinic_id', v_clinic);
end;
$$;

revoke all on function app_transfer_reception_appointment(uuid, uuid, uuid, text) from public, anon;
grant execute on function app_transfer_reception_appointment(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) تعديل الأولوية بسبب
--
-- تقديم مريض على آخر قرار يُسأل عنه — فلا يُترك لتحديث صامت من الواجهة.
-- ---------------------------------------------------------------------------
create or replace function app_set_appointment_priority(
  p_appointment_id uuid,
  p_priority       text,
  p_reason         text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_old appointments%rowtype;
begin
  select * into v_old from appointments where id = p_appointment_id for update;
  if v_old.id is null then
    raise exception 'الموعد غير موجود';
  end if;
  if not app_has_permission(v_old.organization_id, 'appointments.update') then
    raise exception 'صلاحيتك لا تسمح بتعديل الموعد';
  end if;
  if p_priority not in ('normal','urgent','emergency','elderly','accessibility') then
    raise exception 'أولوية غير معروفة: %', p_priority;
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب تغيير الأولوية مطلوب';
  end if;
  if v_old.priority = p_priority then
    raise exception 'الأولوية لم تتغيّر';
  end if;

  update appointments set priority = p_priority, updated_at = now() where id = p_appointment_id;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, reason)
  values (v_old.organization_id, auth.uid(), 'update', 'appointments', p_appointment_id, 'تغيير أولوية',
          jsonb_build_object('from', v_old.priority, 'to', p_priority)::text, btrim(p_reason));
end;
$$;

revoke all on function app_set_appointment_priority(uuid, text, text) from public, anon;
grant execute on function app_set_appointment_priority(uuid, text, text) to authenticated;

commit;
