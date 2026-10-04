-- ============================================================================
-- 0221_doctor_records_prescriptions.sql
-- ============================================================================
-- طلبات المالك (04/10/2026):
--
--   ١) «اسمح لكلّ الأطباء بتعديل السجلّ الطبي وكتابة الملاحظات وتعديلها»:
--      حفظ حالة السنّ ردّ «صلاحيتك لا تسمح بتعديل السجل الطبي» لطبيب.
--      تُمنح `medical_records.write` لصفة الطبيب (الافتراض، وتعديل الصفة في
--      المنشأة، والأدوار المخصّصة المبنيّة عليها)، ويُرفع المنع الصريح عن
--      حسابات الأطباء المربوطة ببطاقاتهم.
--
--   ٢) حالة «خلع» قبل «مخلوع» في مخطّط الأسنان (`to_extract`).
--
--   ٣) الوصفة من الطبيب إلى الاستقبال للطباعة:
--      • الدواء من الكتالوج أو **اسمٌ يُكتب** (العيادة لا صيدلية فيها):
--        `prescription_items.drug_name`، و`drug_item_id` يصير اختياريًّا مع
--        قيدٍ أنّ أحدهما موجود.
--      • `app_issue_prescription` يُصدر الوصفة وبنودها ويُرسلها إلى الاستقبال
--        (`staff_requests.prescription_id`) في معاملةٍ واحدة. الطبيب المربوط
--        يُصدر باسمه وحده.
--      • `v_follow_up_center` يحمل `prescription_id` (في آخره) لزرّ «طباعة».
--
-- لا يمسّ الفواتير ولا ZATCA. معاملة واحدة، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── ١) صلاحية السجلّ الطبي للأطباء ─────────────────────────────────────────
-- المفتاح تفحصه دوالّ مخطّط الأسنان وسجلّ الإجراءات والتقارير (0141، 0143،
-- 0154، 0211) — ولم يكن في كتالوج الصلاحيات، فلا يملكه إلّا المالك والمدير.
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
values ('medical_records.write', 'تعديل السجلّ الطبي', 'medical_records',
        'حالة الأسنان وخطّة العلاج وسجلّ الإجراءات وملاحظاتها والتقارير الطبية.', 610)
on conflict (permission_key) do nothing;

insert into role_default_permissions (role_key, permission_key)
select r.role_key, 'medical_records.write'
  from (values ('doctor'), ('nurse'), ('branch_manager')) as r(role_key)
 where exists (select 1 from permission_catalog where permission_key = 'medical_records.write')
on conflict (role_key, permission_key) do nothing;

with targets as (
  select r.organization_id, r.id as role_id, r.name_ar
    from organization_roles r
   where r.base_role_key in ('doctor', 'nurse', 'branch_manager')
     and r.is_active
     and not r.is_archived
     and not exists (select 1 from organization_role_permissions x
                      where x.role_id = r.id and x.permission_key = 'medical_records.write')
),
granted as (
  insert into organization_role_permissions (organization_id, role_id, permission_key)
  select organization_id, role_id, 'medical_records.write' from targets
  returning organization_id, role_id
)
insert into audit_log (organization_id, user_id, module, action_type, entity_title, details)
select t.organization_id, null, 'users', 'update', 'صلاحية تعديل السجلّ الطبي',
       'مُنحت «تعديل السجلّ الطبي» لـ: ' || string_agg(distinct coalesce(t.name_ar, 'طبيب'), '، ') || ' (0221)'
  from targets t
 where exists (select 1 from granted g where g.role_id = t.role_id)
 group by t.organization_id;

-- المنع الصريح على حساب طبيبٍ مربوط ببطاقته يُرفع (طلب المالك: كلّ الأطباء)
update membership_permissions mp
   set granted = true
 where mp.permission_key = 'medical_records.write'
   and not mp.granted
   and exists (select 1 from doctors d
                where d.organization_id = mp.organization_id and d.user_id = mp.user_id
                  and coalesce(d.is_enabled, true));

-- ── ٢) حالة «خلع» ───────────────────────────────────────────────────────────
create or replace function app_tooth_condition_keys()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array['sound','caries','filled','crown','bridge','implant',
               'root_canal','missing','extracted','impacted','veneer',
               'orthodontic','under_treatment','to_extract'];
$$;

-- ── ٣) الوصفة: دواءٌ من الكتالوج أو اسمٌ يُكتب ──────────────────────────────
alter table public.prescription_items
  add column if not exists drug_name text;
alter table public.prescription_items
  alter column drug_item_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'prescription_items_drug_present'
                    and conrelid = 'public.prescription_items'::regclass) then
    alter table public.prescription_items
      add constraint prescription_items_drug_present
      check (drug_item_id is not null or nullif(btrim(coalesce(drug_name, '')), '') is not null) not valid;
  end if;
end $$;

comment on column public.prescription_items.drug_name is
  'اسم الدواء حين لا يكون في الكتالوج (وصفة العيادة للطباعة). 0221.';

alter table public.staff_requests
  add column if not exists prescription_id uuid references public.prescriptions(id) on delete set null;

comment on column public.staff_requests.prescription_id is
  'وصفةٌ أرسلها الطبيب إلى الاستقبال للطباعة. 0221.';

-- المنظور كما في 0218، و`prescription_id` في آخره
create or replace view v_follow_up_center
with (security_invoker = on) as
select
  'staff'::text           as source_kind,
  sr.id,
  sr.organization_id,
  sr.branch_id,
  sr.request_type,
  sr.status,
  sr.priority,
  sr.patient_id,
  p.name_ar               as patient_name,
  p.file_number,
  p.mobile_number         as patient_mobile,
  sr.doctor_id,
  d.name_ar               as doctor_name,
  sr.body,
  sr.amount,
  null::date              as preferred_date,
  sr.requested_at,
  rq.display_name         as requested_by_name,
  sr.seen_at,
  sn.display_name         as seen_by_name,
  sr.resolved_at,
  rs.display_name         as resolved_by_name,
  sr.resolution_note,
  sr.services,
  sr.prescription_id
from staff_requests sr
left join patients p on p.id = sr.patient_id
left join doctors  d on d.id = sr.doctor_id
left join v_organization_members_directory rq
       on rq.user_id = sr.requested_by and rq.organization_id = sr.organization_id
left join v_organization_members_directory sn
       on sn.user_id = sr.seen_by and sn.organization_id = sr.organization_id
left join v_organization_members_directory rs
       on rs.user_id = sr.resolved_by and rs.organization_id = sr.organization_id
union all
select
  'appointment'::text,
  ar.id,
  ar.organization_id,
  ar.branch_id,
  'follow_up'::text,
  ar.status,
  'routine'::text,
  ar.patient_id,
  p.name_ar,
  p.file_number,
  p.mobile_number,
  ar.doctor_id,
  d.name_ar,
  ar.reason,
  null::numeric,
  ar.preferred_date,
  ar.created_at,
  d.name_ar,
  ar.seen_at,
  sn.display_name,
  ar.decided_at,
  dc.display_name,
  ar.decision_note,
  null::jsonb,
  null::uuid
from appointment_requests ar
left join patients p on p.id = ar.patient_id
left join doctors  d on d.id = ar.doctor_id
left join v_organization_members_directory sn
       on sn.user_id = ar.seen_by and sn.organization_id = ar.organization_id
left join v_organization_members_directory dc
       on dc.user_id = ar.decided_by and dc.organization_id = ar.organization_id
where ar.source = 'doctor';

revoke all on v_follow_up_center from anon;
grant select on v_follow_up_center to authenticated;

-- إصدار الوصفة وإرسالها إلى الاستقبال — معاملة واحدة
create or replace function public.app_issue_prescription(
  p_organization_id  uuid,
  p_patient_id       uuid,
  p_lines            jsonb,
  p_doctor_id        uuid default null,
  p_notes            text default null,
  p_insurance_company text default null,
  p_insurance_policy  text default null,
  p_send_to_reception boolean default true,
  p_branch_id        uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_self   uuid;
  v_doctor uuid := p_doctor_id;
  v_clinic uuid;
  v_id     uuid;
  e        jsonb;
  v_drug   uuid;
  v_name   text;
  v_n      int := 0;
  v_list   text;
  v_pat    text;
  v_doc    text;
  v_req    uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not exists (select 1 from patients where id = p_patient_id and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'أضف دواءً واحدًا على الأقل';
  end if;

  -- الطبيب المربوط حسابه ببطاقته يُصدر باسمه وحده
  select d.id into v_self from doctors d
   where d.organization_id = p_organization_id and d.user_id = auth.uid() and coalesce(d.is_enabled, true)
   limit 1;
  if v_self is not null and not app_has_role(p_organization_id, array['owner', 'organization_admin', 'branch_manager']) then
    v_doctor := v_self;
  end if;
  if v_doctor is not null then
    select d.clinic_id into v_clinic from doctors d
     where d.id = v_doctor and d.organization_id = p_organization_id;
    if not found then
      raise exception 'الطبيب غير موجود في هذه المنشأة';
    end if;
  end if;

  insert into prescriptions (organization_id, patient_id, doctor_id, clinic_id, branch_id, status, issued_at,
                             notes, insurance_company_name, insurance_policy_number, created_by)
  values (p_organization_id, p_patient_id, v_doctor, v_clinic, p_branch_id, 'issued', now(),
          nullif(btrim(coalesce(p_notes, '')), ''),
          nullif(btrim(coalesce(p_insurance_company, '')), ''),
          nullif(btrim(coalesce(p_insurance_policy, '')), ''),
          auth.uid())
  returning id into v_id;

  for e in select value from jsonb_array_elements(p_lines) loop
    v_drug := nullif(e->>'drug_item_id', '')::uuid;
    v_name := nullif(btrim(coalesce(e->>'drug_name', '')), '');
    if v_drug is not null then
      select name_ar into v_name from items where id = v_drug and organization_id = p_organization_id;
      if not found then
        raise exception 'الدواء رقم % ليس في كتالوج المنشأة', v_n + 1;
      end if;
    end if;
    continue when v_drug is null and v_name is null;
    insert into prescription_items (organization_id, prescription_id, drug_item_id, drug_name,
                                    dosage_instructions, frequency, duration_days, route,
                                    quantity_prescribed)
    values (p_organization_id, v_id, v_drug, case when v_drug is null then v_name end,
            nullif(btrim(coalesce(e->>'instructions', '')), ''),
            nullif(btrim(coalesce(e->>'frequency', '')), ''),
            nullif(e->>'duration_days', '')::int,
            coalesce(nullif(e->>'route', ''), 'oral'),
            coalesce(nullif(e->>'quantity', '')::numeric, 1));
    v_n := v_n + 1;
    v_list := concat_ws('، ', v_list, v_name);
  end loop;

  if v_n = 0 then
    raise exception 'أضف دواءً واحدًا على الأقل';
  end if;

  if p_send_to_reception then
    select name_ar into v_pat from patients where id = p_patient_id;
    select name_ar into v_doc from doctors where id = v_doctor;
    insert into staff_requests (organization_id, branch_id, request_type, patient_id, doctor_id,
                                body, priority, requested_by, prescription_id)
    values (p_organization_id, p_branch_id, 'note', p_patient_id, v_doctor,
            left('وصفة طبية للطباعة: ' || v_list, 1000), 'routine', auth.uid(), v_id)
    returning id into v_req;
    perform app_notify_event(
      p_organization_id, 'staff_request_created',
      'وصفة من ' || coalesce(v_doc, 'طبيب'),
      'staff_req:' || v_req::text,
      coalesce(v_pat, '') || ' — وصفة للطباعة: ' || left(v_list, 120),
      'staff_request', v_req, '/follow-up-center', p_branch_id);
  end if;

  return v_id;
end $$;

revoke all on function public.app_issue_prescription(uuid, uuid, jsonb, uuid, text, text, text, boolean, uuid) from public, anon;
grant execute on function public.app_issue_prescription(uuid, uuid, jsonb, uuid, text, text, text, boolean, uuid) to authenticated;

comment on function public.app_issue_prescription(uuid, uuid, jsonb, uuid, text, text, text, boolean, uuid) is
  'إصدار وصفة (دواء من الكتالوج أو اسمٌ يُكتب) وإرسالها إلى الاستقبال للطباعة — معاملة واحدة. 0221.';

commit;

notify pgrst, 'reload schema';

-- ── النتيجة: الأطباء وصلاحية تعديل السجلّ الطبي ─────────────────────────────
select d.name_ar as "الطبيب",
       case when e.is_allowed then 'يستطيع تعديل السجلّ الطبي' else 'لا يستطيع — راجع حسابه' end as "الحالة"
  from doctors d
  join v_user_effective_permissions e
    on e.organization_id = d.organization_id and e.user_id = d.user_id
   and e.permission_key = 'medical_records.write'
 where coalesce(d.is_enabled, true)
 order by 2 desc, 1;
