-- ============================================================================
-- 0207 — عدّادات القائمة الجانبية في استدعاءٍ واحد
-- ============================================================================
--
-- العَرَض (المالك، 01/10/2026): «النظام ثقيل — الضغط على شاشة أو إجراء يأخذ
-- وقتًا حتى يظهر إشعاره».
--
-- من أسبابه: القائمة الجانبية كانت تُطلق **واحدًا وعشرين** طلبًا مستقلًّا
-- (عدّ دقيق لكلّ قسم) عند فتح النظام، وكلّ دقيقتين، وكلّ عودةٍ إلى النافذة —
-- من كلّ جهازٍ مفتوح، وحتى للأقسام التي لا يراها المستخدم. كلّ طلبٍ يشغل
-- اتّصالًا من مجمّع اتّصالات الخادم، فينتظر خلفها طلب الشاشة أو الإجراء الذي
-- ضغطه المستخدم للتوّ.
--
-- الآن: دالّةٌ واحدة تعدّ **ما يظهر للمستخدم فقط** (`p_keys`) في رحلةٍ واحدة
-- واتّصالٍ واحد.
--
-- الأمان: `security invoker` — تجري بصلاحيات المستدعي وسياسات RLS نفسها التي
-- كانت تحكم الطلبات المنفصلة، فلا ترى أكثر ممّا كان يُرى. وكلّ عدّادٍ في كتلةٍ
-- مستقلّة: تعذّرُ واحدٍ (عرضٌ غير موجود، أو لا صلاحية) يُعيده `null` كما كان،
-- ولا يُسقط البقيّة.
--
-- حدود «اليوم» يمرّرها المتصفّح (منتصف ليله المحلّيّ) كما كان يفعل.
--
-- قراءةٌ فقط. لا يمسّ بيانات. آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

create or replace function app_sidebar_badge_counts(
  p_organization_id uuid,
  p_keys            text[],
  p_day_start       timestamptz,
  p_day_end         timestamptz,
  p_doctor_id       uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_out   jsonb := '{}'::jsonb;
  v_key   text;
  v_n     bigint;
  v_known boolean;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null or p_organization_id is null or p_keys is null then
    return v_out;
  end if;

  foreach v_key in array p_keys loop
    v_n := null;
    v_known := true;
    begin
      case v_key
        when 'reception' then
          if p_doctor_id is null then
            select count(*) into v_n from appointments a
             where a.organization_id = p_organization_id
               and a.scheduled_start >= p_day_start and a.scheduled_start < p_day_end;
          else
            select count(*) into v_n from appointments a
             where a.organization_id = p_organization_id
               and a.scheduled_start >= p_day_start and a.scheduled_start < p_day_end
               and a.doctor_id = p_doctor_id;
          end if;

        when 'patients' then
          -- «مريض الطبيب» مصدره `v_doctor_patients` (0164) — مصدر شاشة المرضى نفسه
          if p_doctor_id is null then
            select count(*) into v_n from patients p
             where p.organization_id = p_organization_id;
          else
            select count(*) into v_n from v_doctor_patients dp
             where dp.organization_id = p_organization_id
               and dp.doctor_id = p_doctor_id;
          end if;

        when 'medical-records' then
          if p_doctor_id is null then
            select count(*) into v_n from patient_visits pv
             where pv.organization_id = p_organization_id
               and pv.visit_date >= p_day_start and pv.visit_date < p_day_end;
          else
            select count(*) into v_n from patient_visits pv
             where pv.organization_id = p_organization_id
               and pv.visit_date >= p_day_start and pv.visit_date < p_day_end
               and pv.doctor_id = p_doctor_id;
          end if;

        when 'services' then
          select count(*) into v_n from items i
           where i.organization_id = p_organization_id
             and i.item_type in ('service', 'lab_service')
             and i.is_disabled = false;

        when 'departments' then
          select count(*) into v_n from clinics c
           where c.organization_id = p_organization_id
             and c.is_disabled = false;

        when 'doctors' then
          select count(*) into v_n from doctors d
           where d.organization_id = p_organization_id
             and d.is_enabled = true;

        when 'laboratory' then
          select count(*) into v_n from v_lab_pending_orders x
           where x.organization_id = p_organization_id;

        when 'radiology' then
          select count(*) into v_n from v_radiology_unreported_orders x
           where x.organization_id = p_organization_id;

        when 'pharmacy' then
          select count(*) into v_n from items i
           where i.organization_id = p_organization_id
             and i.item_type = 'drug'
             and i.is_disabled = false;

        when 'dispensing' then
          select count(*) into v_n from v_prescriptions_pending_dispensing x
           where x.organization_id = p_organization_id;

        when 'employees' then
          select count(*) into v_n from employees e
           where e.organization_id = p_organization_id
             and e.status = 'active';

        when 'attendance' then
          select count(*) into v_n from v_today_attendance x
           where x.organization_id = p_organization_id;

        when 'leave' then
          select count(*) into v_n from leave_requests l
           where l.organization_id = p_organization_id
             and l.status = 'pending';

        when 'contracts' then
          select count(*) into v_n from v_employee_contracts_status x
           where x.organization_id = p_organization_id;

        when 'recruitment' then
          select count(*) into v_n from job_postings x
           where x.organization_id = p_organization_id;

        when 'training' then
          select count(*) into v_n from training_programs x
           where x.organization_id = p_organization_id;

        when 'shifts' then
          select count(*) into v_n from shift_templates x
           where x.organization_id = p_organization_id;

        when 'audit' then
          select count(*) into v_n from audit_log x
           where x.organization_id = p_organization_id
             and x.occurred_at >= p_day_start and x.occurred_at < p_day_end;

        when 'purchase-invoices' then
          -- ما ينتظر السداد لا كلّ الفواتير
          select count(*) into v_n from purchase_invoices x
           where x.organization_id = p_organization_id
             and x.status in ('unpaid', 'partial');

        when 'purchase-requests' then
          -- ما ينتظر الاعتماد
          select count(*) into v_n from purchase_requests x
           where x.organization_id = p_organization_id
             and x.status = 'submitted';

        when 'follow-up-center' then
          -- للاستقبال: ما وصل اليوم ولم يُطَّلع عليه. وللطبيب: ما أرسله اليوم.
          if p_doctor_id is null then
            select count(*) into v_n from v_follow_up_center x
             where x.organization_id = p_organization_id
               and x.seen_at is null
               and x.status = 'pending'
               and x.requested_at >= p_day_start and x.requested_at < p_day_end;
          else
            select count(*) into v_n from v_follow_up_center x
             where x.organization_id = p_organization_id
               and x.doctor_id = p_doctor_id
               and x.requested_at >= p_day_start and x.requested_at < p_day_end;
          end if;

        when 'messaging' then
          select count(*) into v_n from v_internal_unread_counts x
           where x.organization_id = p_organization_id
             and x.user_id = v_uid;

        else
          v_known := false;
      end case;
    exception when others then
      v_n := null;
    end;

    if v_known then
      v_out := v_out || jsonb_build_object(v_key, v_n);
    end if;
  end loop;

  return v_out;
end;
$$;

comment on function app_sidebar_badge_counts(uuid, text[], timestamptz, timestamptz, uuid) is
  'عدّادات القائمة الجانبية لما يظهر للمستخدم فقط، في استدعاءٍ واحد وبصلاحياته (RLS). مفتاحٌ تعذّر عدّه ⇒ null. 0207.';

revoke all on function app_sidebar_badge_counts(uuid, text[], timestamptz, timestamptz, uuid) from public;
grant execute on function app_sidebar_badge_counts(uuid, text[], timestamptz, timestamptz, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
