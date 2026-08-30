-- 0074_appointment_service_link.sql
-- ربط الموعد بالخدمة المطلوبة.
--
-- `items.duration_minutes` أُضيف في 0071 ولم يقرأه أحد: شاشة الحجز تكتب ٣٠
-- دقيقة لكل موعد أيًّا كانت الخدمة. وهذا هو العيب نفسه الذي أطارده في هذا
-- المخطط — عمودٌ موجود لا يحرّك شيئًا.
--
-- مع هذه الهجرة يصير اختيار الخدمة في الحجز:
--   • يحدّد مدة الموعد من الخدمة نفسها،
--   • يشتقّ العيادة إن لم تُحدَّد،
--   • ويمنع حجزًا لا يصلح للمريض (عمر، جنس، فرع، مورد).
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) مرحلة الفحص
--
-- الموافقة التأمينية المسبقة تُطلب عادةً **بين** الحجز والتنفيذ، لا قبل
-- الحجز. منعُ الحجز لغيابها يعني منع المريض من حجز الموعد الذي ستُطلب
-- الموافقة من أجله — وهو عكس المقصود. لذا للفحص مرحلتان.
-- ---------------------------------------------------------------------------
create or replace function app_check_service_eligibility(
  p_item_id    uuid,
  p_patient_id uuid,
  p_branch_id  uuid default null,
  p_stage      text default 'execution'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item     items%rowtype;
  v_patient  patients%rowtype;
  v_age      integer;
  v_blocks   text[] := '{}';
  v_warnings text[] := '{}';
  v_preauth  text;
begin
  if p_stage not in ('booking','execution') then
    raise exception 'مرحلة غير معروفة: %', p_stage;
  end if;

  select * into v_item from items where id = p_item_id;
  if v_item.id is null then
    raise exception 'الخدمة غير موجودة';
  end if;
  if not app_is_member(v_item.organization_id) then
    raise exception 'لا صلاحية';
  end if;

  select * into v_patient from patients
   where id = p_patient_id and organization_id = v_item.organization_id;
  if v_patient.id is null then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  if v_item.is_archived then
    v_blocks := array_append(v_blocks, 'الخدمة مؤرشفة');
  elsif v_item.is_disabled then
    v_blocks := array_append(v_blocks, 'الخدمة معطَّلة');
  end if;

  if p_branch_id is not null and not app_item_available_in_branch(p_item_id, p_branch_id) then
    v_blocks := array_append(v_blocks, 'الخدمة غير متاحة في هذا الفرع');
  end if;

  -- العمر
  if v_patient.birth_date is not null then
    v_age := extract(year from age(current_date, v_patient.birth_date))::int;
    if v_item.min_age_years is not null and v_age < v_item.min_age_years then
      v_blocks := array_append(v_blocks,
        format('الخدمة لعمر %s سنة فأكثر، وعمر المريض %s', v_item.min_age_years, v_age));
    end if;
    if v_item.max_age_years is not null and v_age > v_item.max_age_years then
      v_blocks := array_append(v_blocks,
        format('الخدمة لعمر %s سنة فأقل، وعمر المريض %s', v_item.max_age_years, v_age));
    end if;
  elsif v_item.min_age_years is not null or v_item.max_age_years is not null then
    v_warnings := array_append(v_warnings, 'الخدمة مقيّدة بالعمر وتاريخ ميلاد المريض غير مسجَّل');
  end if;

  -- الجنس
  if v_item.gender_restriction <> 'any' then
    if v_patient.gender is null then
      v_warnings := array_append(v_warnings, 'الخدمة مقيّدة بالجنس وجنس المريض غير مسجَّل');
    elsif v_patient.gender <> v_item.gender_restriction then
      v_blocks := array_append(v_blocks,
        case v_item.gender_restriction when 'male' then 'الخدمة للذكور فقط'
                                       else 'الخدمة للإناث فقط' end);
    end if;
  end if;

  -- التحضير والموافقة
  if v_item.requires_fasting then
    v_warnings := array_append(v_warnings,
      coalesce('صيام ' || v_item.fasting_hours || ' ساعة قبل الخدمة', 'الخدمة تتطلّب صيامًا'));
  end if;
  if v_item.preparation_ar is not null and btrim(v_item.preparation_ar) <> '' then
    v_warnings := array_append(v_warnings, 'تحضير مطلوب: ' || v_item.preparation_ar);
  end if;
  if v_item.requires_consent then
    v_warnings := array_append(v_warnings, 'تتطلّب موافقة موقَّعة من المريض');
  end if;
  if v_item.requires_referral then
    v_warnings := array_append(v_warnings, 'تتطلّب إحالة من طبيب');
  end if;

  -- الموافقة المسبقة
  if v_item.requires_preauthorization then
    select p.status into v_preauth
      from insurance_preauthorizations p
     where p.patient_id = p_patient_id
       and p.organization_id = v_item.organization_id
       and p.status = 'approved'
       and p.requested_at > now() - interval '90 days'
     order by p.requested_at desc
     limit 1;

    if v_preauth is null then
      if p_stage = 'booking' then
        -- تنبيه لا مانع: الموافقة تُطلب بعد الحجز عادةً.
        v_warnings := array_append(v_warnings,
          'تتطلّب موافقة تأمين مسبقة — اطلبها قبل موعد التنفيذ');
      else
        v_blocks := array_append(v_blocks,
          'تتطلّب موافقة تأمين مسبقة، ولا توجد موافقة سارية للمريض');
      end if;
    end if;
  end if;

  -- الموارد
  if exists (
    select 1 from item_resources ir
     where ir.item_id = p_item_id and ir.is_required
       and not exists (
         select 1 from resources r
          where r.id = ir.resource_id and r.is_active
            and (p_branch_id is null or r.branch_id is null or r.branch_id = p_branch_id)
       )
  ) then
    v_blocks := array_append(v_blocks, 'مورد مطلوب للخدمة غير متاح في هذا الفرع');
  end if;

  return jsonb_build_object(
    'ok', cardinality(v_blocks) = 0,
    'blocks', to_jsonb(v_blocks),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

-- النسخة ذات الوسائط الثلاثة كانت موقّعةً مستقلة؛ تُحذف كي لا يبقى تعريفان
-- يختلف سلوكهما بلا سبب ظاهر للقارئ.
drop function if exists app_check_service_eligibility(uuid, uuid, uuid);

revoke all on function app_check_service_eligibility(uuid, uuid, uuid, text) from public, anon;
grant execute on function app_check_service_eligibility(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) الخدمة على الموعد
-- ---------------------------------------------------------------------------
alter table appointments
  add column if not exists item_id uuid references items(id) on delete set null;

create index if not exists idx_appointments_item on appointments (item_id) where item_id is not null;

comment on column appointments.item_id is
  'الخدمة المطلوبة في هذا الموعد. تحدّد المدة والعيادة، وتُفحص ملاءمتها للمريض عند الحجز.';

-- ---------------------------------------------------------------------------
-- 3) اشتقاق العيادة وفحص الملاءمة عند الحجز
--
-- المدة تبقى قرار الشاشة: الاشتقاق التلقائي لمدة موعدٍ قائم كان سيحرّك
-- نهايته من تحت يد من حجزه. أمّا العيادة فتُشتقّ إن كانت فارغة فقط.
-- ---------------------------------------------------------------------------
create or replace function app_appointment_service_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_check  jsonb;
  v_blocks text;
  v_item   items%rowtype;
begin
  if new.item_id is null then
    return new;
  end if;

  select * into v_item from items where id = new.item_id;
  if v_item.id is null or v_item.organization_id <> new.organization_id then
    raise exception 'الخدمة لا تنتمي لهذه المنشأة';
  end if;

  if new.clinic_id is null then
    new.clinic_id := v_item.default_clinic_id;
  end if;

  -- الحجز المباشر والانتظار لا يمرّان بالفحص: كلاهما حالة قائمة أمام
  -- الموظف، ومنعُها لا يعني إلغاء الزيارة بل تسجيلها خارج النظام.
  if new.status in ('walk_in','waiting') then
    return new;
  end if;

  v_check := app_check_service_eligibility(new.item_id, new.patient_id, new.branch_id, 'booking');

  if not (v_check ->> 'ok')::boolean then
    select string_agg(value, ' — ') into v_blocks
      from jsonb_array_elements_text(v_check -> 'blocks');
    raise exception 'لا يمكن حجز «%» لهذا المريض: %', v_item.name_ar, v_blocks;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointment_service_guard on appointments;
create trigger trg_appointment_service_guard
  before insert or update of item_id on appointments
  for each row execute function app_appointment_service_guard();

-- ---------------------------------------------------------------------------
-- 4) الخدمات المنفَّذة غير المفوترة — متابعة مالية
--
-- `v_visit_services_status` (0073) تعرض كل الحالات. هذا المنظور يجيب سؤالًا
-- واحدًا: ما الذي نُفِّذ ولم يصل إلى فاتورة بعد، ومنذ كم يوم.
-- ---------------------------------------------------------------------------
create or replace view v_unbilled_performed_services as
select
  s.id,
  s.organization_id,
  s.visit_id,
  v.patient_id,
  p.name_ar        as patient_name,
  p.file_number,
  s.item_id,
  i.name_ar        as item_name,
  i.medical_service_type,
  s.qty,
  s.unit_price,
  (s.qty * coalesce(s.unit_price, 0)) as line_total,
  v.doctor_id,
  d.name_ar        as doctor_name,
  v.clinic_id,
  v.visit_date,
  (current_date - v.visit_date::date) as days_since_visit,
  s.status
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join patients p on p.id = v.patient_id
join items i on i.id = s.item_id
left join doctors d on d.id = v.doctor_id
where s.status in ('draft','ordered','performed');

alter view v_unbilled_performed_services set (security_invoker = on);
revoke all on v_unbilled_performed_services from anon;
grant select on v_unbilled_performed_services to authenticated;

comment on view v_unbilled_performed_services is
  'خدمات نُفِّذت في زيارات ولم تُفوتَر بعد، مع عدد الأيام منذ الزيارة.';

commit;
