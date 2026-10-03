-- ============================================================================
-- 0218_login_directory_followup_services.sql
-- ============================================================================
-- طلبات المالك (03/10/2026):
--
--   ١) الدخول باسم الطبيب أو المسؤول لا بالبريد: الحاسوب الواحد يعمل عليه
--      أكثر من طبيب. `app_login_directory()` تعيد أسماء من يدخلون النظام
--      (الأطباء ثم بقيّة الموظفين) لشاشة الدخول قبل تسجيله — **اختيار المالك
--      أن تظهر لكلّ من يفتح الموقع**، فهي ممنوحةٌ لـ anon، ومقصورةٌ على منشأةٍ
--      فعّل لها المالك ذلك (`organizations.login_directory`). كلمة المرور تبقى
--      هي الحماية.
--
--   ٢) مركز المتابعة: الطبيب يختار خدمات (من الكتالوج) بسعرٍ وخصمٍ يعدّلهما
--      هنا فقط، فتصل إلى الاستقبال مع الملاحظة. لا فاتورة تصدر، ولا يتغيّر
--      سعر الخدمة في الكتالوج. تُحفظ في `staff_requests.services` (عمودٌ في
--      الجدول القائم، لا جدولٌ جديد) ومجموعها في `amount`.
--
--   ٣) الخدمات بحسب تخصّص الطبيب (أسنان / جلدية): `v_item_service_domain`
--      لكلّ خدمة، و`v_doctor_service_domain` لكلّ طبيب. منتقي الخدمات يعرض
--      للطبيب خدمات مجاله وما لا مجال له (كالإجازة المرضية).
--
-- لا يمسّ الفواتير ولا ZATCA ولا الاتفاقيات ولا صلاحيات القاعدة.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── ١) دليل الدخول ──────────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists login_directory boolean not null default false;

comment on column public.organizations.login_directory is
  'تظهر أسماء موظّفي المنشأة في شاشة الدخول (قبل تسجيله) ليختار الداخل اسمه ثم يكتب كلمة المرور. 0218.';

update public.organizations
   set login_directory = true
 where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
   and not login_directory;

create or replace function public.app_login_directory()
returns table (
  user_id      uuid,
  display_name text,
  role_label   text,
  group_key    text,
  email        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with m as (
    select distinct on (m.user_id)
           m.user_id, m.organization_id, m.role_key, m.custom_role_id, m.display_name
      from organization_memberships m
      join organizations o on o.id = m.organization_id and o.login_directory
     where m.is_active
     order by m.user_id, m.created_at
  )
  select m.user_id,
         coalesce(d.name_ar, nullif(btrim(m.display_name), ''), e.name_ar, split_part(u.email, '@', 1)) as display_name,
         coalesce(case when d.id is not null and m.role_key in ('doctor', 'nurse') then null else r.name_ar end,
                  case m.role_key
                    when 'owner'              then 'المالك'
                    when 'organization_admin' then 'مدير النظام'
                    when 'branch_manager'     then 'مدير الفرع'
                    when 'doctor'             then 'طبيب'
                    when 'nurse'              then 'تمريض'
                    when 'receptionist'       then 'الاستقبال'
                    when 'accountant'         then 'المحاسبة'
                    else m.role_key
                  end) as role_label,
         case when d.id is not null then 'doctor' else 'staff' end as group_key,
         lower(u.email) as email
    from m
    join auth.users u on u.id = m.user_id
    left join doctors d on d.organization_id = m.organization_id and d.user_id = m.user_id
                       and coalesce(d.is_enabled, true)
    left join employees e on e.organization_id = m.organization_id and e.user_id = m.user_id
    left join organization_roles r on r.id = m.custom_role_id and r.is_active and not r.is_archived
   where nullif(btrim(u.email), '') is not null
     and coalesce((to_jsonb(u) ->> 'banned_until')::timestamptz, '-infinity') < now()
     and (to_jsonb(u) ->> 'deleted_at') is null
   order by case when d.id is not null then 0 else 1 end, 2;
$$;

revoke all on function public.app_login_directory() from public;
grant execute on function public.app_login_directory() to anon, authenticated;

comment on function public.app_login_directory() is
  'أسماء من يدخلون النظام لشاشة الدخول: الأطباء ثم بقيّة الموظفين، للمنشآت التي فعّلت login_directory. 0218.';

-- ── ٢) خدمات الطبيب في مركز المتابعة ───────────────────────────────────────
alter table public.staff_requests
  add column if not exists services jsonb;

comment on column public.staff_requests.services is
  'خدمات اختارها الطبيب للاستقبال: [{item_id, code, name, price, discount, net}] — السعر والخصم هنا فقط، لا يتغيّر الكتالوج ولا تصدر فاتورة. 0218.';

-- المنظور كما في 0173، وعمود الخدمات في آخره
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
  sr.services
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
  null::jsonb
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

-- الإرسال: كما في 0173 ومعه الخدمات. التوقيع يتغيّر (معاملٌ أخير بافتراض)،
-- فيُحذف القديم أوّلًا حتى لا يبقى توقيعان يحار بينهما PostgREST.
drop function if exists public.app_send_follow_up_note(uuid, uuid, text, uuid, text, uuid);

create or replace function public.app_send_follow_up_note(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_body            text,
  p_doctor_id       uuid default null,
  p_priority        text default 'routine',
  p_branch_id       uuid default null,
  p_services        jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_self     uuid;
  v_doctor   uuid;
  v_body     text := nullif(btrim(coalesce(p_body, '')), '');
  v_id       uuid;
  v_doc      text;
  v_pat      text;
  v_services jsonb := '[]'::jsonb;
  v_total    numeric := 0;
  v_summary  text;
  e          jsonb;
  v_item     record;
  v_price    numeric;
  v_disc     numeric;
  v_n        int := 0;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'follow_up_center.send') then
    raise exception 'صلاحيتك لا تسمح بإرسال إشعارات المتابعة (follow_up_center.send)';
  end if;

  -- الخدمات: من الكتالوج وحده؛ السعر والخصم كما كتبهما الطبيب
  if p_services is not null and jsonb_typeof(p_services) = 'array' then
    for e in select value from jsonb_array_elements(p_services) loop
      v_n := v_n + 1;
      if v_n > 30 then
        raise exception 'خدماتٌ كثيرة في ملاحظةٍ واحدة — ثلاثون على الأكثر';
      end if;
      select i.id, i.code, i.name_ar, i.price
        into v_item
        from items i
       where i.id = nullif(e->>'item_id', '')::uuid
         and i.organization_id = p_organization_id
         and not coalesce(i.is_archived, false);
      if not found then
        raise exception 'الخدمة رقم % ليست في كتالوج المنشأة', v_n;
      end if;
      v_price := round(coalesce(nullif(e->>'price', '')::numeric, v_item.price, 0), 2);
      v_disc  := round(coalesce(nullif(e->>'discount', '')::numeric, 0), 2);
      if v_price < 0 then
        raise exception 'سعر «%» لا يكون سالبًا', v_item.name_ar;
      end if;
      if v_disc < 0 or v_disc > v_price then
        raise exception 'خصم «%» بين صفرٍ والسعر', v_item.name_ar;
      end if;
      v_services := v_services || jsonb_build_object(
        'item_id', v_item.id, 'code', v_item.code, 'name', v_item.name_ar,
        'catalog_price', v_item.price, 'price', v_price, 'discount', v_disc,
        'net', v_price - v_disc);
      v_total := v_total + (v_price - v_disc);
    end loop;
  end if;
  if jsonb_array_length(v_services) = 0 then
    v_services := null;
  end if;

  if v_body is null and v_services is null then
    raise exception 'اكتب الملاحظة أو اختر خدمة';
  end if;
  if v_body is not null and length(v_body) > 1000 then
    raise exception 'الملاحظة أطول من ألف حرف — اختصرها';
  end if;
  if coalesce(p_priority, 'routine') not in ('routine', 'urgent') then
    raise exception 'الأولوية إمّا عادية أو عاجلة';
  end if;
  if p_patient_id is null then
    raise exception 'اختر المريض';
  end if;
  if not exists (select 1 from patients
                  where id = p_patient_id and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  -- الطبيب المربوط حسابه ببطاقته يُرسل باسمه وحده، ولمرضاه وحدهم
  select d.id into v_self
    from doctors d
   where d.organization_id = p_organization_id
     and d.user_id = auth.uid()
     and coalesce(d.is_enabled, true) = true
   limit 1;

  if v_self is not null then
    if p_doctor_id is not null and p_doctor_id <> v_self then
      raise exception 'لا تُرسل باسم طبيبٍ آخر';
    end if;
    v_doctor := v_self;
    if not exists (
      select 1 from v_doctor_patients vp
       where vp.doctor_id = v_self
         and vp.id = p_patient_id
         and vp.organization_id = p_organization_id
    ) then
      raise exception 'هذا المريض ليس من مرضاك — لا طبيبًا معالجًا ولا مشاركًا ولا له معك موعدٌ أو زيارة';
    end if;
  else
    if not app_has_role(p_organization_id, array['owner', 'organization_admin']) then
      raise exception 'حسابك غير مربوط ببطاقة طبيب في هذه المنشأة';
    end if;
    if p_doctor_id is null then
      raise exception 'اختر الطبيب الذي تُرسَل الملاحظة باسمه';
    end if;
    if not exists (select 1 from doctors
                    where id = p_doctor_id and organization_id = p_organization_id
                      and coalesce(is_enabled, true) = true) then
      raise exception 'الطبيب غير موجود أو معطَّل في هذه المنشأة';
    end if;
    v_doctor := p_doctor_id;
  end if;

  if v_services is not null then
    select string_agg(x->>'name', '، ') into v_summary from jsonb_array_elements(v_services) x;
  end if;

  insert into staff_requests (organization_id, branch_id, request_type, patient_id,
                              doctor_id, body, amount, services, priority, requested_by)
  values (p_organization_id, p_branch_id, 'note', p_patient_id,
          v_doctor, v_body, case when v_services is not null then v_total end, v_services,
          coalesce(p_priority, 'routine'), auth.uid())
  returning id into v_id;

  select name_ar into v_doc from doctors  where id = v_doctor;
  select name_ar into v_pat from patients where id = p_patient_id;

  perform app_notify_event(
    p_organization_id, 'staff_request_created',
    'ملاحظة من ' || coalesce(v_doc, 'طبيب'),
    'staff_req:' || v_id::text,
    coalesce(v_pat, '') || ' — ' || left(concat_ws(' — ',
      case when v_summary is not null then 'خدمات: ' || v_summary || ' (' || v_total || ')' end,
      v_body), 160),
    'staff_request', v_id, '/follow-up-center', p_branch_id);

  return v_id;
end;
$$;

revoke all on function public.app_send_follow_up_note(uuid, uuid, text, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.app_send_follow_up_note(uuid, uuid, text, uuid, text, uuid, jsonb) to authenticated;

comment on function public.app_send_follow_up_note(uuid, uuid, text, uuid, text, uuid, jsonb) is
  'ملاحظة الطبيب إلى الاستقبال، ومعها خدماتٌ من الكتالوج بسعرٍ وخصمٍ يحدّدهما الطبيب (لا فاتورة). 0173 + 0218.';

-- ── ٣) مجال الخدمة ومجال الطبيب: أسنان / جلدية ─────────────────────────────
create or replace function public.app_service_domain(p_code text, p_name text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_code, '') ~* 'derm' or coalesce(p_name, '') ~ 'جلد' or coalesce(p_name, '') ~* 'derm'
      then 'derma'
    when coalesce(p_code, '') ~* '(dent|ortho|endo|perio|prosth|pedo)'
         or coalesce(p_name, '') ~ '(أسنان|اسنان|الأسنان|الاسنان|تقويم)'
         or coalesce(p_name, '') ~* 'dent'
      then 'dental'
  end;
$$;

comment on function public.app_service_domain(text, text) is
  'مجال الخدمة أو التخصص من رمزه أو اسمه: derma للجلدية، dental للأسنان، وإلّا لا مجال. 0218.';

-- الخدمة: من فئتها وما فوقها (حتى ثلاثة مستويات)، و«أخرى» (كالإجازة المرضية) بلا مجال
create or replace view v_item_service_domain
with (security_invoker = on) as
select i.id as item_id,
       i.organization_id,
       case
         when i.medical_service_type = 'other' then null
         else coalesce(
           app_service_domain(gp.extra->>'specialty_code', gp.name_ar),
           app_service_domain(p.extra->>'specialty_code', p.name_ar),
           app_service_domain(v.extra->>'specialty_code', v.name_ar),
           case when i.medical_service_type = 'dental' then 'dental' end)
       end as service_domain
  from items i
  left join lookup_values v  on v.id = i.category_value_id
  left join lookup_values p  on p.id = v.parent_value_id
  left join lookup_values gp on gp.id = p.parent_value_id;

revoke all on v_item_service_domain from anon;
grant select on v_item_service_domain to authenticated;

-- الطبيب: من تخصّصه، وإلّا من عياداته إن كانت كلّها مجالًا واحدًا
create or replace view v_doctor_service_domain
with (security_invoker = on) as
select d.id as doctor_id,
       d.organization_id,
       coalesce(
         app_service_domain(sp.extra->>'specialty_code', sp.name_ar),
         app_service_domain(s.extra->>'specialty_code', s.name_ar),
         (select min(x.dom)
            from (select coalesce(app_service_domain(c.clinic_type, c.name),
                                  app_service_domain(cs.extra->>'specialty_code', cs.name_ar)) as dom
                    from clinics c
                    left join lookup_values cs on cs.id = c.specialty_value_id
                   where c.id = d.clinic_id
                      or c.id in (select dc.clinic_id from doctor_clinics dc
                                   where dc.doctor_id = d.id and dc.is_active)) x
          having count(distinct x.dom) = 1 and count(*) = count(x.dom))
       ) as service_domain
  from doctors d
  left join lookup_values s  on s.id = d.specialty_value_id
  left join lookup_values sp on sp.id = s.parent_value_id;

revoke all on v_doctor_service_domain from anon;
grant select on v_doctor_service_domain to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── النتيجة: راجِع مجال كلّ طبيب وعدد خدمات كلّ مجال ───────────────────────
select 'طبيب' as "النوع", d.name_ar as "الاسم",
       coalesce(case v.service_domain when 'dental' then 'أسنان' when 'derma' then 'جلدية' end,
                'كلّ الخدمات (لم يُعرف تخصّصه)') as "المجال"
  from doctors d
  join v_doctor_service_domain v on v.doctor_id = d.id
 where coalesce(d.is_enabled, true)
   and d.organization_id in (select id from organizations where login_directory)
union all
select 'خدمات', coalesce(case s.service_domain when 'dental' then 'أسنان' when 'derma' then 'جلدية' end, 'عامّة (تظهر للجميع)'),
       count(*)::text
  from v_item_service_domain s
  join items i on i.id = s.item_id
 where not coalesce(i.is_archived, false)
   and s.organization_id in (select id from organizations where login_directory)
 group by s.service_domain
union all
select 'شاشة الدخول', case group_key when 'doctor' then 'أطباء' else 'موظفون' end, count(*)::text
  from app_login_directory()
 group by group_key
union all
select 'إضافة خدمة جديدة (catalog.manage)', app_member_user_name(e.organization_id, e.user_id), 'يستطيع'
  from v_user_effective_permissions e
 where e.permission_key = 'catalog.manage' and e.is_allowed
   and e.organization_id in (select id from organizations where login_directory)
order by 1, 2;
