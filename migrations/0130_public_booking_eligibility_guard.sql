create or replace function public.app_check_service_eligibility(
  p_item_id uuid,
  p_patient_id uuid,
  p_branch_id uuid default null,
  p_stage text default 'execution'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item items%rowtype;
  v_patient patients%rowtype;
  v_age integer;
  v_blocks text[] := '{}';
  v_warnings text[] := '{}';
  v_preauth insurance_preauthorizations%rowtype;
begin
  if p_stage not in ('booking','execution') then
    raise exception 'مرحلة غير معروفة: %', p_stage;
  end if;

  select * into v_item from items where id = p_item_id;
  if v_item.id is null then raise exception 'الخدمة غير موجودة'; end if;

  if not app_is_member(v_item.organization_id)
     and not (
       auth.role() = 'anon'
       and p_stage = 'booking'
       and v_item.item_type = 'service'
       and v_item.medical_service_type = 'dental'
       and exists (
         select 1
           from public.public_booking_settings s
          where s.organization_id = v_item.organization_id
            and s.is_enabled
       )
     ) then
    raise exception 'لا صلاحية';
  end if;

  select * into v_patient from patients
   where id = p_patient_id and organization_id = v_item.organization_id;
  if v_patient.id is null then raise exception 'المريض غير موجود في هذه المنشأة'; end if;

  if v_item.is_archived then
    v_blocks := array_append(v_blocks, 'الخدمة مؤرشفة');
  elsif v_item.is_disabled then
    v_blocks := array_append(v_blocks, 'الخدمة معطَّلة');
  end if;

  if p_branch_id is not null and not app_item_available_in_branch(p_item_id, p_branch_id) then
    v_blocks := array_append(v_blocks, 'الخدمة غير متاحة في هذا الفرع');
  end if;

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

  if v_item.gender_restriction <> 'any' then
    if v_patient.gender is null then
      v_warnings := array_append(v_warnings, 'الخدمة مقيّدة بالجنس وجنس المريض غير مسجَّل');
    elsif v_patient.gender <> v_item.gender_restriction then
      v_blocks := array_append(v_blocks,
        case v_item.gender_restriction when 'male' then 'الخدمة للذكور فقط'
                                       else 'الخدمة للإناث فقط' end);
    end if;
  end if;

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

  if v_item.requires_preauthorization then
    v_preauth := app_active_preauthorization(p_patient_id, p_item_id, current_date);
    if v_preauth.id is null then
      if p_stage = 'booking' then
        v_warnings := array_append(v_warnings,
          'تتطلّب موافقة تأمين مسبقة لهذه الخدمة — اطلبها قبل موعد التنفيذ');
      else
        v_blocks := array_append(v_blocks,
          'تتطلّب موافقة تأمين مسبقة لهذه الخدمة، ولا توجد موافقة سارية');
      end if;
    elsif v_preauth.valid_to is not null and v_preauth.valid_to <= current_date + 7 then
      v_warnings := array_append(v_warnings,
        format('الموافقة المسبقة تنتهي بتاريخ %s', v_preauth.valid_to));
    end if;
  end if;

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

revoke all on function public.app_check_service_eligibility(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.app_check_service_eligibility(uuid, uuid, uuid, text)
  to authenticated;
