-- 0050_appointments_reception_workflow.sql

create or replace function app_has_role(target_org_id uuid, allowed_roles text[])
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from organization_memberships m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active
      and m.role_key = any(allowed_roles)
  );
$$;
revoke all on function app_has_role(uuid, text[]) from public, anon;
grant execute on function app_has_role(uuid, text[]) to authenticated;

alter table appointments
  add column if not exists priority text not null default 'normal',
  add column if not exists queue_number integer,
  add column if not exists cancellation_reason text,
  add column if not exists no_show_reason text;

alter table appointments drop constraint if exists appointments_priority_check;
alter table appointments add constraint appointments_priority_check
  check (priority in ('normal', 'urgent', 'emergency', 'elderly', 'accessibility'));

alter table appointments drop constraint if exists appointments_status_check;
alter table appointments add constraint appointments_status_check check (status in (
  'new','scheduled','confirmed','unconfirmed','arrived','checked_in','called',
  'in_progress','completed','no_show','cancelled_by_patient','cancelled_by_staff',
  'walk_in','waiting'
));

alter table appointment_waitlist
  add column if not exists appointment_id uuid references appointments(id) on delete set null,
  add column if not exists desired_date date,
  add column if not exists priority text not null default 'normal',
  add column if not exists contacted_at timestamptz,
  add column if not exists booked_at timestamptz;

alter table appointment_waitlist drop constraint if exists appointment_waitlist_priority_check;
alter table appointment_waitlist add constraint appointment_waitlist_priority_check
  check (priority in ('normal', 'urgent', 'emergency', 'elderly', 'accessibility'));

alter table message_log
  add column if not exists appointment_id uuid references appointments(id) on delete set null;

create table if not exists appointment_reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  reminder_type text not null default '24h' check (reminder_type in ('24h', '2h')),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, reminder_type)
);
create index if not exists idx_appointment_reminder_jobs_due
  on appointment_reminder_jobs (status, due_at) where status = 'pending';

alter table appointment_reminder_jobs enable row level security;
drop policy if exists appointment_reminder_jobs_read on appointment_reminder_jobs;
create policy appointment_reminder_jobs_read on appointment_reminder_jobs
  for select using (app_is_member(organization_id));
drop policy if exists appointment_reminder_jobs_manage on appointment_reminder_jobs;
create policy appointment_reminder_jobs_manage on appointment_reminder_jobs
  for all using (app_has_role(organization_id, array['owner','organization_admin','branch_manager']))
  with check (app_has_role(organization_id, array['owner','organization_admin','branch_manager']));

create unique index if not exists idx_patient_visits_one_per_appointment
  on patient_visits (appointment_id) where appointment_id is not null;
create unique index if not exists idx_waitlist_booked_appointment
  on appointment_waitlist (appointment_id) where appointment_id is not null;
create index if not exists idx_appointments_queue
  on appointments (organization_id, scheduled_start, priority, queue_number);

alter table doctors drop constraint if exists doctors_organization_id_id_key;
alter table doctors add constraint doctors_organization_id_id_key unique (organization_id, id);
alter table patients drop constraint if exists patients_organization_id_id_key;
alter table patients add constraint patients_organization_id_id_key unique (organization_id, id);
alter table clinics drop constraint if exists clinics_organization_id_id_key;
alter table clinics add constraint clinics_organization_id_id_key unique (organization_id, id);
alter table appointments drop constraint if exists appointments_organization_id_id_key;
alter table appointments add constraint appointments_organization_id_id_key unique (organization_id, id);

alter table appointments drop constraint if exists appointments_doctor_tenant_fk;
alter table appointments add constraint appointments_doctor_tenant_fk
  foreign key (organization_id, doctor_id) references doctors(organization_id, id) not valid;
alter table appointments drop constraint if exists appointments_patient_tenant_fk;
alter table appointments add constraint appointments_patient_tenant_fk
  foreign key (organization_id, patient_id) references patients(organization_id, id) not valid;
alter table appointments drop constraint if exists appointments_clinic_tenant_fk;
alter table appointments add constraint appointments_clinic_tenant_fk
  foreign key (organization_id, clinic_id) references clinics(organization_id, id) not valid;

alter table appointment_waitlist drop constraint if exists waitlist_patient_tenant_fk;
alter table appointment_waitlist add constraint waitlist_patient_tenant_fk
  foreign key (organization_id, patient_id) references patients(organization_id, id) not valid;
alter table appointment_waitlist drop constraint if exists waitlist_doctor_tenant_fk;
alter table appointment_waitlist add constraint waitlist_doctor_tenant_fk
  foreign key (organization_id, doctor_id) references doctors(organization_id, id) not valid;

alter table patient_visits drop constraint if exists patient_visits_patient_tenant_fk;
alter table patient_visits add constraint patient_visits_patient_tenant_fk
  foreign key (organization_id, patient_id) references patients(organization_id, id) not valid;
alter table patient_visits drop constraint if exists patient_visits_doctor_tenant_fk;
alter table patient_visits add constraint patient_visits_doctor_tenant_fk
  foreign key (organization_id, doctor_id) references doctors(organization_id, id) not valid;
alter table patient_visits drop constraint if exists patient_visits_clinic_tenant_fk;
alter table patient_visits add constraint patient_visits_clinic_tenant_fk
  foreign key (organization_id, clinic_id) references clinics(organization_id, id) not valid;
alter table patient_visits drop constraint if exists patient_visits_appointment_tenant_fk;
alter table patient_visits add constraint patient_visits_appointment_tenant_fk
  foreign key (organization_id, appointment_id) references appointments(organization_id, id) not valid;

alter table sales_invoices drop constraint if exists sales_invoices_patient_tenant_fk;
alter table sales_invoices add constraint sales_invoices_patient_tenant_fk
  foreign key (organization_id, patient_id) references patients(organization_id, id) not valid;
alter table sales_invoices drop constraint if exists sales_invoices_doctor_tenant_fk;
alter table sales_invoices add constraint sales_invoices_doctor_tenant_fk
  foreign key (organization_id, doctor_id) references doctors(organization_id, id) not valid;
alter table sales_invoices drop constraint if exists sales_invoices_clinic_tenant_fk;
alter table sales_invoices add constraint sales_invoices_clinic_tenant_fk
  foreign key (organization_id, clinic_id) references clinics(organization_id, id) not valid;
alter table sales_invoices drop constraint if exists sales_invoices_appointment_tenant_fk;
alter table sales_invoices add constraint sales_invoices_appointment_tenant_fk
  foreign key (organization_id, appointment_id) references appointments(organization_id, id) not valid;

create or replace function app_prevent_appointment_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.scheduled_end <= new.scheduled_start then
    raise exception 'وقت نهاية الموعد يجب أن يكون بعد وقت البداية';
  end if;

  if new.status in ('completed','no_show','cancelled_by_patient','cancelled_by_staff','waiting','walk_in') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || new.doctor_id::text, 0));

  if exists (
    select 1 from appointments a
    where a.organization_id = new.organization_id
      and a.doctor_id = new.doctor_id
      and a.id <> new.id
      and a.status not in ('completed','no_show','cancelled_by_patient','cancelled_by_staff','waiting','walk_in')
      and tstzrange(a.scheduled_start, a.scheduled_end, '[)') &&
          tstzrange(new.scheduled_start, new.scheduled_end, '[)')
  ) then
    raise exception 'يوجد موعد آخر للطبيب يتداخل مع الوقت المختار';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_prevent_appointment_overlap on appointments;
create trigger trg_prevent_appointment_overlap
  before insert or update of organization_id, doctor_id, scheduled_start, scheduled_end, status
  on appointments for each row execute function app_prevent_appointment_overlap();

create or replace function app_validate_appointment_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status then return new; end if;

  if not (
    (old.status in ('new','scheduled','unconfirmed') and new.status in ('confirmed','arrived','checked_in','cancelled_by_patient','cancelled_by_staff','no_show')) or
    (old.status = 'confirmed' and new.status in ('arrived','checked_in','cancelled_by_patient','cancelled_by_staff','no_show')) or
    (old.status = 'arrived' and new.status in ('checked_in','called','in_progress','cancelled_by_staff','no_show')) or
    (old.status = 'checked_in' and new.status in ('called','in_progress','cancelled_by_staff')) or
    (old.status = 'called' and new.status in ('in_progress','cancelled_by_staff')) or
    (old.status in ('waiting','walk_in') and new.status in ('called','in_progress','cancelled_by_staff')) or
    (old.status = 'in_progress' and new.status = 'completed')
  ) then
    raise exception 'انتقال حالة الموعد غير مسموح: % إلى %', old.status, new.status;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_appointment_status_transition on appointments;
create trigger trg_validate_appointment_status_transition
  before update of status on appointments
  for each row execute function app_validate_appointment_status_transition();

create or replace function app_reception_transition(p_appointment_id uuid, p_action text, p_reason text default null)
returns table (appointment_id uuid, appointment_status text, visit_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v appointments%rowtype;
  v_visit_id uuid;
  v_next_status text;
  v_queue integer;
begin
  select * into v from appointments where id = p_appointment_id for update;
  if v.id is null then raise exception 'الموعد غير موجود'; end if;
  if not app_has_role(v.organization_id, array['owner','organization_admin','branch_manager','receptionist','doctor','nurse']) then
    raise exception 'لا تملك صلاحية تنفيذ إجراء الاستقبال';
  end if;

  if p_action = 'arrive' and v.status in ('new','scheduled','confirmed','unconfirmed') then
    select coalesce(max(a.queue_number), 0) + 1 into v_queue
    from appointments a
    where a.organization_id = v.organization_id
      and a.scheduled_start::date = v.scheduled_start::date;
    update appointments set status = 'arrived', checked_in_1_at = coalesce(checked_in_1_at, now()),
      queue_number = coalesce(queue_number, v_queue), updated_at = now() where id = v.id;
    v_next_status := 'arrived';
  elsif p_action = 'check_in' and v.status = 'arrived' then
    update appointments set status = 'checked_in', checked_in_2_at = coalesce(checked_in_2_at, now()), updated_at = now() where id = v.id;
    v_next_status := 'checked_in';
  elsif p_action = 'call' and v.status in ('arrived','checked_in','waiting','walk_in') then
    update appointments set status = 'called', called_at = coalesce(called_at, now()), updated_at = now() where id = v.id;
    v_next_status := 'called';
  elsif p_action = 'start' and v.status in ('called','checked_in','waiting','walk_in','arrived') then
    update appointments set status = 'in_progress', entered_at = coalesce(entered_at, now()), updated_at = now() where id = v.id;
    insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id, appointment_id, created_by)
    values (v.organization_id, v.patient_id, v.doctor_id, v.clinic_id, v.id, auth.uid())
    on conflict (appointment_id) where appointment_id is not null do update
      set doctor_id = excluded.doctor_id, clinic_id = excluded.clinic_id
    returning id into v_visit_id;
    v_next_status := 'in_progress';
  elsif p_action = 'finish' and v.status = 'in_progress' then
    update appointments set status = 'completed', left_at = coalesce(left_at, now()), updated_at = now() where id = v.id;
    select id into v_visit_id from patient_visits where appointment_id = v.id;
    v_next_status := 'completed';
  elsif p_action = 'no_show' and v.status in ('new','scheduled','confirmed','unconfirmed','arrived') then
    update appointments set status = 'no_show', no_show_reason = nullif(trim(p_reason), ''), updated_at = now() where id = v.id;
    v_next_status := 'no_show';
  else
    raise exception 'الإجراء % غير مسموح للحالة %', p_action, v.status;
  end if;

  return query select v.id, v_next_status, v_visit_id;
end;
$$;
revoke all on function app_reception_transition(uuid, text, text) from public, anon;
grant execute on function app_reception_transition(uuid, text, text) to authenticated;

create or replace function app_add_walk_in(
  p_organization_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_clinic_id uuid default null,
  p_priority text default 'normal',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queue integer;
  v_id uuid;
begin
  if not app_has_role(p_organization_id, array['owner','organization_admin','branch_manager','receptionist']) then
    raise exception 'لا تملك صلاحية إضافة مريض للطابور';
  end if;
  if not exists (select 1 from patients where id = p_patient_id and organization_id = p_organization_id) then
    raise exception 'المريض لا يتبع المنشأة النشطة';
  end if;
  if not exists (select 1 from doctors where id = p_doctor_id and organization_id = p_organization_id and is_enabled and not disabled_from_booking) then
    raise exception 'الطبيب غير متاح للحجز';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':queue:' || current_date::text, 0));
  select coalesce(max(queue_number), 0) + 1 into v_queue
  from appointments
  where organization_id = p_organization_id and scheduled_start::date = current_date;

  insert into appointments (
    organization_id, patient_id, doctor_id, clinic_id, scheduled_start, scheduled_end,
    status, priority, queue_number, note, checked_in_1_at, created_by
  ) values (
    p_organization_id, p_patient_id, p_doctor_id, p_clinic_id, now(), now() + interval '30 minutes',
    'waiting', p_priority, v_queue, nullif(trim(p_note), ''), now(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app_add_walk_in(uuid, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function app_add_walk_in(uuid, uuid, uuid, uuid, text, text) to authenticated;

create or replace function app_convert_waitlist_to_appointment(
  p_waitlist_id uuid,
  p_doctor_id uuid,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_clinic_id uuid default null,
  p_visit_type_value_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v appointment_waitlist%rowtype;
  v_appointment_id uuid;
begin
  select * into v from appointment_waitlist where id = p_waitlist_id for update;
  if v.id is null then raise exception 'طلب الانتظار غير موجود'; end if;
  if v.status <> 'waiting' then raise exception 'تمت معالجة طلب الانتظار مسبقًا'; end if;
  if not app_has_role(v.organization_id, array['owner','organization_admin','branch_manager','receptionist']) then
    raise exception 'لا تملك صلاحية تحويل قائمة الانتظار';
  end if;

  insert into appointments (
    organization_id, patient_id, doctor_id, clinic_id, scheduled_start, scheduled_end,
    visit_type_value_id, note, status, priority, created_by
  ) values (
    v.organization_id, v.patient_id, p_doctor_id, p_clinic_id, p_scheduled_start, p_scheduled_end,
    p_visit_type_value_id, coalesce(nullif(trim(p_note), ''), v.registration_note), 'scheduled', v.priority, auth.uid()
  ) returning id into v_appointment_id;

  update appointment_waitlist
  set status = 'booked', appointment_id = v_appointment_id, booked_at = now(), contacted_at = coalesce(contacted_at, now())
  where id = v.id;
  return v_appointment_id;
end;
$$;
revoke all on function app_convert_waitlist_to_appointment(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function app_convert_waitlist_to_appointment(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text) to authenticated;

create or replace function app_schedule_appointment_reminders()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('new','scheduled','confirmed','unconfirmed') then
    update appointment_reminder_jobs set status = 'cancelled', updated_at = now()
    where appointment_id = new.id and status in ('pending','processing');
    return new;
  end if;

  insert into appointment_reminder_jobs (organization_id, appointment_id, reminder_type, due_at)
  values
    (new.organization_id, new.id, '24h', greatest(now(), new.scheduled_start - interval '24 hours')),
    (new.organization_id, new.id, '2h', greatest(now(), new.scheduled_start - interval '2 hours'))
  on conflict (appointment_id, reminder_type) do update
    set due_at = excluded.due_at, status = 'pending', attempts = 0,
        last_error = null, processed_at = null, updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_queue_appointment_reminder on appointments;
drop trigger if exists trg_schedule_appointment_reminders on appointments;
create trigger trg_schedule_appointment_reminders
  after insert or update of scheduled_start, status on appointments
  for each row execute function app_schedule_appointment_reminders();

create or replace function app_process_due_appointment_reminders(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job record;
  v_template text;
  v_patient patients%rowtype;
  v_doctor_name text;
  v_message text;
  v_processed integer := 0;
begin
  for v_job in
    select j.id, j.organization_id, j.appointment_id, j.reminder_type,
           a.patient_id, a.doctor_id, a.scheduled_start
    from appointment_reminder_jobs j
    join appointments a on a.id = j.appointment_id
    where j.status = 'pending' and j.due_at <= now()
      and a.status in ('new','scheduled','confirmed','unconfirmed')
    order by j.due_at
    for update of j skip locked
    limit greatest(1, least(p_limit, 500))
  loop
    select mt.template_text into v_template
    from message_templates mt
    where mt.organization_id = v_job.organization_id
      and mt.event_key = 'appointment_reminder'
      and mt.channel = 'sms' and not mt.is_disabled
    limit 1;
    select * into v_patient from patients where id = v_job.patient_id;
    select d.name_ar into v_doctor_name from doctors d where d.id = v_job.doctor_id;

    if v_template is null or v_patient.id is null or v_patient.block_sms then
      update appointment_reminder_jobs
      set status = 'cancelled', processed_at = now(), updated_at = now()
      where id = v_job.id;
      continue;
    end if;

    v_message := replace(v_template, '{{patient_name}}', coalesce(v_patient.name_ar, ''));
    v_message := replace(v_message, '{{doctor_name}}', coalesce(v_doctor_name, ''));
    v_message := replace(v_message, '{{appointment_time}}', to_char(v_job.scheduled_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'));

    insert into message_log (
      organization_id, patient_id, appointment_id, channel, event_key,
      message_text, status, created_by
    ) values (
      v_job.organization_id, v_job.patient_id, v_job.appointment_id, 'sms',
      'appointment_reminder', v_message, 'queued', null
    );
    update appointment_reminder_jobs
    set status = 'sent', processed_at = now(), updated_at = now()
    where id = v_job.id;
    update appointments set sms_reminder_sent = true where id = v_job.appointment_id;
    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$$;
revoke all on function app_process_due_appointment_reminders(integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('zaincare-appointment-reminders');
    exception when others then
      null;
    end;
    perform cron.schedule(
      'zaincare-appointment-reminders',
      '* * * * *',
      'select public.app_process_due_appointment_reminders(100)'
    );
  end if;
end;
$$;

alter table appointments enable row level security;
drop policy if exists appointments_all_members on appointments;
drop policy if exists appointments_read_members on appointments;
create policy appointments_read_members on appointments
  for select using (app_is_member(organization_id));
drop policy if exists appointments_insert_staff on appointments;
create policy appointments_insert_staff on appointments
  for insert with check (app_has_role(organization_id, array['owner','organization_admin','branch_manager','receptionist']));
drop policy if exists appointments_update_staff on appointments;
create policy appointments_update_staff on appointments
  for update using (app_has_role(organization_id, array['owner','organization_admin','branch_manager','receptionist']))
  with check (app_has_role(organization_id, array['owner','organization_admin','branch_manager','receptionist']));
drop policy if exists appointments_delete_admins on appointments;
create policy appointments_delete_admins on appointments
  for delete using (app_has_role(organization_id, array['owner','organization_admin']));

alter table appointment_waitlist enable row level security;
drop policy if exists waitlist_all_members on appointment_waitlist;
drop policy if exists waitlist_read_members on appointment_waitlist;
create policy waitlist_read_members on appointment_waitlist
  for select using (app_is_member(organization_id));
drop policy if exists waitlist_insert_staff on appointment_waitlist;
create policy waitlist_insert_staff on appointment_waitlist
  for insert with check (app_has_role(organization_id, array['owner','organization_admin','branch_manager','receptionist']));
drop policy if exists waitlist_update_staff on appointment_waitlist;
create policy waitlist_update_staff on appointment_waitlist
  for update using (app_has_role(organization_id, array['owner','organization_admin','branch_manager','receptionist']))
  with check (app_has_role(organization_id, array['owner','organization_admin','branch_manager','receptionist']));
drop policy if exists waitlist_delete_admins on appointment_waitlist;
create policy waitlist_delete_admins on appointment_waitlist
  for delete using (app_has_role(organization_id, array['owner','organization_admin']));

alter table patient_visits enable row level security;
drop policy if exists patient_visits_all_members on patient_visits;
drop policy if exists patient_visits_read_members on patient_visits;
create policy patient_visits_read_members on patient_visits
  for select using (app_is_member(organization_id));
drop policy if exists patient_visits_insert_clinical on patient_visits;
create policy patient_visits_insert_clinical on patient_visits
  for insert with check (app_has_role(organization_id, array['owner','organization_admin','doctor','nurse']));
drop policy if exists patient_visits_update_clinical on patient_visits;
create policy patient_visits_update_clinical on patient_visits
  for update using (app_has_role(organization_id, array['owner','organization_admin','doctor','nurse']))
  with check (app_has_role(organization_id, array['owner','organization_admin','doctor','nurse']));
drop policy if exists patient_visits_delete_admins on patient_visits;
create policy patient_visits_delete_admins on patient_visits
  for delete using (app_has_role(organization_id, array['owner','organization_admin']));

alter table sales_invoices enable row level security;
drop policy if exists sales_invoices_all_members on sales_invoices;
drop policy if exists sales_invoices_read_members on sales_invoices;
create policy sales_invoices_read_members on sales_invoices
  for select using (app_is_member(organization_id));
drop policy if exists sales_invoices_insert_finance on sales_invoices;
create policy sales_invoices_insert_finance on sales_invoices
  for insert with check (app_has_role(organization_id, array['owner','organization_admin','accountant','receptionist']));
drop policy if exists sales_invoices_update_finance on sales_invoices;
create policy sales_invoices_update_finance on sales_invoices
  for update using (app_has_role(organization_id, array['owner','organization_admin','accountant','receptionist']))
  with check (app_has_role(organization_id, array['owner','organization_admin','accountant','receptionist']));
drop policy if exists sales_invoices_delete_finance on sales_invoices;
create policy sales_invoices_delete_finance on sales_invoices
  for delete using (
    app_has_role(organization_id, array['owner','organization_admin','accountant']) or
    (app_has_role(organization_id, array['receptionist']) and status = 'unpaid' and paid_amount = 0)
  );

alter table sales_invoice_items enable row level security;
drop policy if exists sales_invoice_items_all_members on sales_invoice_items;
drop policy if exists sales_invoice_items_read_members on sales_invoice_items;
create policy sales_invoice_items_read_members on sales_invoice_items
  for select using (exists (
    select 1 from sales_invoices i where i.id = invoice_id and app_is_member(i.organization_id)
  ));
drop policy if exists sales_invoice_items_insert_finance on sales_invoice_items;
create policy sales_invoice_items_insert_finance on sales_invoice_items
  for insert with check (exists (
    select 1 from sales_invoices i where i.id = invoice_id
      and app_has_role(i.organization_id, array['owner','organization_admin','accountant','receptionist'])
  ));
drop policy if exists sales_invoice_items_update_finance on sales_invoice_items;
create policy sales_invoice_items_update_finance on sales_invoice_items
  for update using (exists (
    select 1 from sales_invoices i where i.id = invoice_id
      and app_has_role(i.organization_id, array['owner','organization_admin','accountant','receptionist'])
  ));
drop policy if exists sales_invoice_items_delete_finance on sales_invoice_items;
create policy sales_invoice_items_delete_finance on sales_invoice_items
  for delete using (exists (
    select 1 from sales_invoices i where i.id = invoice_id
      and app_has_role(i.organization_id, array['owner','organization_admin','accountant'])
  ));

drop trigger if exists trg_audit_appointment_waitlist on appointment_waitlist;
create trigger trg_audit_appointment_waitlist
  after insert or update or delete on appointment_waitlist
  for each row execute function app_audit_log_auto('status');
