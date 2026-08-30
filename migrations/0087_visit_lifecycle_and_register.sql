-- 0087_visit_lifecycle_and_register.sql
-- المرحلة السابعة: سجل زيارات المرضى — دورة حياة الزيارة وشاشتها التشغيلية.
--
-- الحالة قبل هذا الملف: **`patient_visits` بلا عمود حالة إطلاقًا**. الزيارة
-- إمّا موجودة أو لا. فلا يُعرف أي زيارة ما زالت مفتوحة، ولا أيها وقّعها
-- الطبيب، ولا أيها أُغلق ماليًا. وشاشة «سجل الزيارات» تعرض قائمة بلا حالة
-- لأن الحالة ليست في المخطط.
--
-- ونتيجة ذلك عملية: زيارةٌ بدأها الطبيب ولم يكملها تبدو كزيارة مكتملة
-- تمامًا، ولا تقرير يكشفها.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) دورة حياة الزيارة
--
--   مخطَّطة → منتظرة → جارية → مكتملة → موقَّعة → مغلقة
--   والاستثناءان: ملغاة، ومعادة الفتح.
--
-- التوقيع فعلٌ سريري (الطبيب يقرّ بما كتبه)، والإغلاق فعلٌ ماليّ (لا فوترة
-- بعده). فصلُهما مقصود: زيارة موقَّعة سريريًا قد تنتظر تسوية تأمين أسابيع.
-- ---------------------------------------------------------------------------
alter table patient_visits
  add column if not exists status        text not null default 'completed',
  add column if not exists started_at    timestamptz,
  add column if not exists ended_at      timestamptz,
  add column if not exists signed_at     timestamptz,
  add column if not exists signed_by     uuid references auth.users(id),
  add column if not exists closed_at     timestamptz,
  add column if not exists closed_by     uuid references auth.users(id),
  add column if not exists reopened_at   timestamptz,
  add column if not exists reopened_by   uuid references auth.users(id),
  add column if not exists reopen_reason text,
  add column if not exists cancel_reason text,
  add column if not exists updated_by    uuid references auth.users(id);

comment on column patient_visits.status is
  'دورة الزيارة: planned مخطَّطة، waiting منتظرة، in_progress جارية، completed مكتملة، signed موقَّعة سريريًا، closed مغلقة ماليًا، cancelled ملغاة.';
comment on column patient_visits.signed_at is
  'توقيع الطبيب على محتوى الزيارة — فعل سريري.';
comment on column patient_visits.closed_at is
  'الإغلاق المالي — لا فوترة بعده. منفصل عن التوقيع عمدًا.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_visits_status_check') then
    alter table patient_visits add constraint patient_visits_status_check check (
      status in ('planned','waiting','in_progress','completed','signed','closed','cancelled')
    );
  end if;
end $$;

create index if not exists idx_visits_status on patient_visits (organization_id, status, visit_date desc);

-- الصفوف القائمة زياراتٌ ماضية: تُعدّ **مكتملة** لا موقَّعة ولا مغلقة.
-- التوقيع والإغلاق فعلان يقوم بهما إنسان، ولا يُستنتجان بأثر رجعي.
update patient_visits set status = 'completed' where status is null;

-- ---------------------------------------------------------------------------
-- 2) الانتقالات
-- ---------------------------------------------------------------------------
create or replace function app_visit_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'planned'     then p_to in ('waiting','in_progress','cancelled')
    when 'waiting'     then p_to in ('in_progress','cancelled')
    when 'in_progress' then p_to in ('completed','cancelled')
    when 'completed'   then p_to in ('signed','in_progress')
    when 'signed'      then p_to in ('closed','in_progress')   -- الأخيرة إعادة فتح
    when 'closed'      then p_to in ('in_progress')            -- إعادة فتح فقط
    else false   -- cancelled نهائية
  end;
$$;

insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('visits.view',    'عرض سجل الزيارات',   'visits', 900),
  ('visits.update',  'تعديل الزيارات',     'visits', 902),
  ('visits.sign',    'توقيع الزيارات',     'visits', 904),
  ('visits.close',   'إغلاق الزيارات',     'visits', 906),
  ('visits.reopen',  'إعادة فتح الزيارات', 'visits', 908)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('doctor',         'visits.view'), ('doctor', 'visits.update'), ('doctor', 'visits.sign'),
  ('nurse',          'visits.view'), ('nurse', 'visits.update'),
  ('receptionist',   'visits.view'),
  ('accountant',     'visits.view'), ('accountant', 'visits.close'),
  ('branch_manager', 'visits.view'), ('branch_manager', 'visits.update'),
  ('branch_manager', 'visits.close'), ('branch_manager', 'visits.reopen')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

create or replace function app_set_visit_status(
  p_visit_id uuid,
  p_status   text,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit    patient_visits%rowtype;
  v_perm     text;
  v_reopen   boolean;
  v_unbilled int;
begin
  select * into v_visit from patient_visits where id = p_visit_id for update;
  if v_visit.id is null then
    raise exception 'الزيارة غير موجودة';
  end if;
  if not app_is_member(v_visit.organization_id) then
    raise exception 'لا صلاحية';
  end if;
  if v_visit.status = p_status then
    return;
  end if;
  if not app_visit_status_allowed(v_visit.status, p_status) then
    raise exception 'لا يمكن الانتقال من «%» إلى «%»', v_visit.status, p_status;
  end if;

  -- إعادة الفتح: الرجوع من مكتملة أو موقَّعة أو مغلقة إلى جارية.
  v_reopen := p_status = 'in_progress'
              and v_visit.status in ('completed','signed','closed');

  v_perm := case
    when v_reopen              then 'visits.reopen'
    when p_status = 'signed'   then 'visits.sign'
    when p_status = 'closed'   then 'visits.close'
    when p_status = 'cancelled' then 'visits.update'
    else 'visits.update'
  end;

  if not app_has_permission(v_visit.organization_id, v_perm) then
    raise exception 'صلاحيتك لا تسمح بهذا الإجراء (%)', v_perm;
  end if;

  if (v_reopen or p_status = 'cancelled') and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'هذا الإجراء يحتاج سببًا مكتوبًا';
  end if;

  -- لا إغلاق ماليّ وثمّة خدمة منفَّذة لم تُفوتَر: الإغلاق يعني «لا فوترة
  -- بعده»، فإغلاقه على خدمة تنتظر الفوترة إسقاطٌ صامت لإيراد.
  if p_status = 'closed' then
    select count(*) into v_unbilled
      from patient_visit_services s
     where s.visit_id = p_visit_id
       and s.status in ('draft','ordered','performed');
    if v_unbilled > 0 then
      raise exception 'بقي % خدمة منفَّذة لم تُفوتَر — فوترها أو ألغِها قبل الإغلاق', v_unbilled;
    end if;
  end if;

  -- لا إلغاء لزيارة عليها فاتورة سارية
  if p_status = 'cancelled' and exists (
       select 1 from sales_invoice_items li
       join sales_invoices i on i.id = li.invoice_id
       join patient_visit_services s on s.id = li.visit_service_id
      where s.visit_id = p_visit_id and i.status <> 'void'
     ) then
    raise exception 'للزيارة فاتورة سارية — ألغِ الفاتورة أولًا';
  end if;

  update patient_visits set
    status = p_status,
    updated_at = now(),
    updated_by = auth.uid(),
    started_at  = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
    ended_at    = case when p_status = 'completed' then now() else ended_at end,
    signed_at   = case when p_status = 'signed' then now()
                       when v_reopen then null else signed_at end,
    signed_by   = case when p_status = 'signed' then auth.uid()
                       when v_reopen then null else signed_by end,
    closed_at   = case when p_status = 'closed' then now()
                       when v_reopen then null else closed_at end,
    closed_by   = case when p_status = 'closed' then auth.uid()
                       when v_reopen then null else closed_by end,
    reopened_at = case when v_reopen then now() else reopened_at end,
    reopened_by = case when v_reopen then auth.uid() else reopened_by end,
    reopen_reason = case when v_reopen then btrim(p_reason) else reopen_reason end,
    cancel_reason = case when p_status = 'cancelled' then btrim(p_reason) else cancel_reason end
  where id = p_visit_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_visit.organization_id, auth.uid(), 'visits', 'update', p_visit_id,
          'زيارة مريض',
          case when v_reopen then format('إعادة فتح: %s ← %s', v_visit.status, p_status)
               else format('%s ← %s', v_visit.status, p_status) end,
          nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

revoke all on function app_set_visit_status(uuid, text, text) from public, anon;
grant execute on function app_set_visit_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) الزيارة الموقَّعة أو المغلقة لا تُعدَّل مباشرةً
--
-- التوقيع بلا قفلٍ يليه ليس توقيعًا. من أراد التعديل يعيد الفتح بسبب
-- مسجَّل، فيبقى الأثر.
-- ---------------------------------------------------------------------------
create or replace function app_guard_signed_visit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status not in ('signed','closed') then
    return new;
  end if;

  -- تغيير الحالة نفسه مسموح (يمرّ بالدالة التي تفحص الصلاحية والسبب).
  if new.status is distinct from old.status then
    return new;
  end if;

  if new.main_complaint is distinct from old.main_complaint
     or new.exam_data is distinct from old.exam_data
     or new.notes is distinct from old.notes
     or new.next_visit_plan is distinct from old.next_visit_plan
     or new.doctor_id is distinct from old.doctor_id
     or new.clinic_id is distinct from old.clinic_id then
    raise exception 'الزيارة % — أعد فتحها بسبب مسجَّل قبل التعديل',
      case old.status when 'signed' then 'موقَّعة' else 'مغلقة' end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_signed_visit on patient_visits;
create trigger trg_guard_signed_visit
  before update on patient_visits
  for each row execute function app_guard_signed_visit();

-- ---------------------------------------------------------------------------
-- 4) منظور السجل التشغيلي
--
-- كل ما تعرضه الشاشة في استعلام واحد. حسابه هنا لا في المتصفّح: الشاشة
-- تعرض مئة صفّ، وحسابُ حالة الفاتورة لكل صفّ هناك مئة استعلام.
-- ---------------------------------------------------------------------------
create or replace view v_visit_register as
select
  v.id,
  v.organization_id,
  v.branch_id,
  b.name              as branch_name,
  v.patient_id,
  p.name_ar           as patient_name,
  p.file_number,
  p.mobile_number,
  v.doctor_id,
  d.name_ar           as doctor_name,
  v.clinic_id,
  c.name              as clinic_name,
  c.department_id,
  v.appointment_id,
  a.scheduled_start   as appointment_at,
  v.visit_date,
  v.started_at,
  v.ended_at,
  v.status,
  v.signed_at,
  v.signed_by,
  v.closed_at,
  v.closed_by,
  v.reopened_at,
  v.reopen_reason,
  v.main_complaint,
  dx.primary_diagnosis,
  coalesce(svc.service_count, 0)      as service_count,
  coalesce(svc.unbilled_count, 0)     as unbilled_service_count,
  coalesce(svc.total_amount, 0)       as services_amount,
  inv.invoice_id,
  inv.invoice_number,
  inv.invoice_status,
  inv.net_amount                      as invoice_amount,
  inv.remaining_amount,
  inv.is_insurance_invoice,
  inv.insurance_company_name,
  claim.claim_status,
  -- زيارة بلا فاتورة وبها خدمات: أول ما يُبحث عنه في مراجعة الإيراد
  (coalesce(svc.service_count, 0) > 0 and inv.invoice_id is null) as has_services_no_invoice,
  v.created_at,
  v.updated_at
from patient_visits v
join patients p on p.id = v.patient_id
left join doctors d on d.id = v.doctor_id
left join clinics c on c.id = v.clinic_id
left join branches b on b.id = v.branch_id
left join appointments a on a.id = v.appointment_id
left join lateral (
  select count(*) as service_count,
         count(*) filter (where s.status in ('draft','ordered','performed')) as unbilled_count,
         sum(s.qty * coalesce(s.unit_price, 0)) as total_amount
    from patient_visit_services s where s.visit_id = v.id
) svc on true
left join lateral (
  select i.id as invoice_id, i.invoice_number, i.status as invoice_status,
         i.net_amount, i.remaining_amount, i.is_insurance_invoice, i.insurance_company_name
    from sales_invoice_items li
    join sales_invoices i on i.id = li.invoice_id
    join patient_visit_services s on s.id = li.visit_service_id
   where s.visit_id = v.id and i.status <> 'void'
   order by i.created_at desc
   limit 1
) inv on true
left join lateral (
  select bi.status as claim_status
    from insurance_claim_batch_items bi
   where bi.sales_invoice_id = inv.invoice_id
   order by bi.id desc
   limit 1
) claim on true
left join lateral (
  select string_agg(coalesce(ic.name_ar, ic.name_en, ic.code), '، ') as primary_diagnosis
    from patient_visit_diagnoses vd
    left join icd10_codes ic on ic.id = vd.icd10_code_id
   where vd.visit_id = v.id
) dx on true;

alter view v_visit_register set (security_invoker = on);
revoke all on v_visit_register from anon;
grant select on v_visit_register to authenticated;

-- ---------------------------------------------------------------------------
-- 5) الزيارات غير المكتملة — ما يجب أن يراه المدير كل صباح
-- ---------------------------------------------------------------------------
create or replace view v_incomplete_visits as
select
  r.*,
  case
    when r.status = 'in_progress' and r.visit_date < current_date then 'زيارة جارية من يوم سابق'
    when r.status = 'completed' and r.visit_date < current_date - 2 then 'مكتملة ولم تُوقَّع'
    when r.has_services_no_invoice then 'خدمات بلا فاتورة'
    when r.unbilled_service_count > 0 then 'خدمات لم تُفوتَر'
    else null
  end as issue,
  (current_date - r.visit_date::date) as days_open
from v_visit_register r
where r.status not in ('closed','cancelled')
  and (
    (r.status = 'in_progress' and r.visit_date < current_date)
    or (r.status = 'completed' and r.visit_date < current_date - 2)
    or r.has_services_no_invoice
    or r.unbilled_service_count > 0
  );

alter view v_incomplete_visits set (security_invoker = on);
revoke all on v_incomplete_visits from anon;
grant select on v_incomplete_visits to authenticated;

commit;
