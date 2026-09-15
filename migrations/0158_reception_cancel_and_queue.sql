-- =============================================================================
-- 0158_reception_cancel_and_queue.sql
-- إلغاء الموعد من الطابور، وتجميع الطابور بالطبيب.
-- =============================================================================
--
-- **العيب الأول:** لا سبيل لإخراج موعدٍ من الطابور إلا بـ«لم يحضر». مريضٌ
-- اعتذر، أو حُجز له مرّتين بالخطأ، أو غيّر رأيه — يبقى في الطابور بقيّة اليوم
-- ويُحسب في عدّاد الانتظار ويظهر أمام الطبيب. و«لم يحضر» ليست الحقيقة: هو
-- حضر وانصرف، أو لم يُحجز له أصلًا.
--
-- `app_reception_transition` تعرف تسعة إجراءات وليس فيها إلغاء، مع أنّ خريطة
-- الانتقالات في المُحفِّز (0065) تسمح بـ`cancelled_by_staff` من كل حالات
-- الطابور. القدرة موجودة في القاعدة ولا باب لها.
--
-- **إلغاء لا حذف:** الموعد يخرج من `v_reception_queue` بتغيّر حالته ويبقى في
-- السجلّ بسببه ووقته ومن ألغاه — فيُعرف بعد شهر كم موعدًا أُلغي ولماذا.
--
-- **والمال يمنع الإلغاء:** موعدٌ عليه فاتورة محصَّلة يُلغى يترك مبلغًا مقبوضًا
-- بلا موعدٍ يفسّره ويختلّ جرد اليومية.
--
-- **العيب الثاني:** الطابور قائمةٌ واحدة مسطَّحة. الاستقبال يرى الجميع ولا
-- يعرف مَن ينتظر أيّ طبيب إلا بترشيح طبيبٍ واحد في كل مرّة، والطبيب لا يرى
-- طابوره وحده. `v_reception_queue_by_doctor` يُجمّع العدّادات لكل طبيب في
-- صفٍّ واحد، فيُعرض عنوانٌ فوق مجموعته وتُقرأ الشاشة نظرةً واحدة.
--
-- الدالّة أُعيدت من 0065 **حرفًا بحرف** وأُضيف إليها فرعٌ واحد: `create or
-- replace` تستبدل الجسم كلّه، فأيّ سطرٍ يسقط سهوًا يُسقط إجراءً يعمل اليوم.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- ١) إجراء الإلغاء
-- ═══════════════════════════════════════════════════════════════════════════

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
    -- الإلغاء صلاحيةُ نقلٍ لا صلاحيةُ تسجيلِ وصول: من ينادي المرضى لا يُلغي
    -- مواعيدهم. وهي الصلاحية نفسها التي يُنقَل بها المريض بين الأطباء.
    when 'cancel'   then 'reception.transfer'
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

  elsif p_action = 'cancel' then
    -- **إلغاء لا حذف.** الموعد يخرج من الطابور بتغيّر حالته، ويبقى في السجلّ
    -- بسببه ووقته ومن ألغاه — فيُعرف بعد شهر كم موعدًا أُلغي ولماذا. والحذف
    -- يخالف قاعدة «لا حذف نهائيّ» ويُفقد إحصاء الإلغاء كلّه.
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'سبب الإلغاء مطلوب';
    end if;
    if v.status = 'completed' then
      raise exception 'الزيارة انتهت — الموعد المكتمل لا يُلغى';
    end if;
    -- **المال يمنع الإلغاء.** موعدٌ عليه فاتورة محصَّلة يُلغى يترك مبلغًا
    -- مقبوضًا بلا موعدٍ يفسّره، ويختلّ جرد اليومية. تُعالَج الفاتورة أوّلًا
    -- (استرداد أو إلغاء) ثمّ يُلغى الموعد.
    if exists (
      select 1 from sales_invoices s
       where s.appointment_id = v.id
         and s.invoice_type = 'sale'
         and coalesce(s.status, '') <> 'void'
         and coalesce(s.paid_amount, 0) > 0
    ) then
      raise exception 'على الموعد فاتورة محصَّلة — عالِج الفاتورة (استرداد أو إلغاء) قبل إلغاء الموعد';
    end if;

    update appointments
       set status = 'cancelled_by_staff',
           cancellation_reason = btrim(p_reason),
           updated_at = now()
     where id = v.id;
    v_next_status := 'cancelled_by_staff';

    insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, reason)
    values (v.organization_id, auth.uid(), 'update', 'appointments', v.id, 'إلغاء موعد من الطابور',
            jsonb_build_object('from', v.status, 'to', v_next_status)::text, btrim(p_reason));

  else
    raise exception 'الإجراء % غير مسموح للحالة %', p_action, v.status;
  end if;

  return query select v.id, v_next_status, v_visit_id;
end;
$$;

revoke all on function app_reception_transition(uuid, text, text) from public, anon;
grant execute on function app_reception_transition(uuid, text, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الطابور مُجمَّعًا بالطبيب
--
-- صفٌّ لكل طبيبٍ له منتظرون اليوم، بعدّاداته: كم في الانتظار، وكم نُودي، وكم
-- دخل العيادة، وأطول انتظار عنده. الاستقبال يقرأ الضغط على كل طبيب نظرةً
-- واحدة بدل ترشيح طبيبٍ بعد طبيب.
--
-- الأطباء بلا منتظرين لا يظهرون: صفٌّ بأصفارٍ يُطيل الشاشة ولا يقول شيئًا.
-- ═══════════════════════════════════════════════════════════════════════════

drop view if exists v_reception_queue_by_doctor;
create view v_reception_queue_by_doctor
with (security_invoker = on) as
select
  q.organization_id,
  q.branch_id,
  q.doctor_id,
  q.doctor_name,
  count(*)                                                          as total,
  count(*) filter (where q.status in ('confirmed','walk_in','waiting'))  as waiting_count,
  count(*) filter (where q.status = 'arrived')                      as arrived_count,
  count(*) filter (where q.status = 'checked_in')                   as checked_in_count,
  count(*) filter (where q.status = 'called')                       as called_count,
  count(*) filter (where q.status = 'in_progress')                  as in_progress_count,
  max(q.waiting_minutes)                                            as longest_wait_minutes,
  min(q.scheduled_start)                                            as first_slot
from v_reception_queue q
group by q.organization_id, q.branch_id, q.doctor_id, q.doctor_name;

comment on view v_reception_queue_by_doctor is
  'ضغط الطابور على كل طبيب: عدد المنتظرين والمُنادَين والداخلين وأطول انتظار. الأطباء بلا منتظرين لا يظهرون.';

grant select on v_reception_queue_by_doctor to authenticated;

notify pgrst, 'reload schema';
