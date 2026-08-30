-- 0075_package_usage_guards.sql
-- استهلاك الباقات: إغلاق ثغرتين، وربطه بمتطلّبات الخدمة السريرية.
--
-- `app_validate_package_usage` قائم منذ 0015 ويفحص حالة الباقة وصلاحيتها
-- والرصيد. لكنه يترك بابين مفتوحين:
--
--   1) **سباق.** يقرأ المستهلَك ثم يقارن، بلا قفل. طلبان متزامنان على باقة
--      بقيت فيها جلسة واحدة يقرآن «المتبقي ١» كلاهما، فتُستهلك مرتين.
--      المعاملتان صحيحتان كلٌّ على حدة، والنتيجة رصيد سالب.
--
--   2) **بند من باقة أخرى.** لا يتحقّق أن `package_item_id` ينتمي إلى باقة
--      هذا الاشتراك. فبند «١٠ جلسات علاج طبيعي» من باقة أخرى يُقبل هنا،
--      ويُحسب رصيده من تلك الباقة لا من هذه، ولا يظهر في منظور الأرصدة
--      أصلًا — استهلاك لا أثر له.
--
-- ويضيف هذا الملف ما لم يكن موجودًا: فحص ملاءمة الخدمة للمريض عند
-- الاستهلاك، وتسجيل من استهلك ومتى ومع أي موعد.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) الحارس المصحَّح
-- ---------------------------------------------------------------------------
create or replace function app_validate_package_usage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  included     numeric;
  already_used numeric;
  sub          patient_packages%rowtype;
  v_item       uuid;
  v_check      jsonb;
  v_blocks     text;
begin
  -- `for update` يسلسل الطلبات المتزامنة على الاشتراك نفسه: الثاني ينتظر
  -- الأول فيقرأ رصيدًا محدَّثًا بدل رصيد قديم.
  select * into sub from patient_packages where id = new.patient_package_id for update;
  if sub.id is null then
    raise exception 'الاشتراك غير موجود';
  end if;
  if sub.status <> 'active' then
    raise exception 'لا يمكن الاستهلاك من باقة غير نشطة (الحالة الحالية: %)', sub.status;
  end if;
  if sub.expires_at is not null and sub.expires_at < now() then
    raise exception 'انتهت صلاحية هذه الباقة بتاريخ %', sub.expires_at;
  end if;

  select pi.quantity_included, pi.item_id into included, v_item
    from package_items pi
   where pi.id = new.package_item_id
     and pi.package_id = sub.package_id;

  if included is null then
    raise exception 'هذا البند لا ينتمي إلى باقة هذا الاشتراك';
  end if;

  if new.quantity_used is null or new.quantity_used <= 0 then
    raise exception 'الكمية المستهلكة يجب أن تكون أكبر من صفر';
  end if;

  select coalesce(sum(quantity_used), 0) into already_used
    from patient_package_usages
   where package_item_id = new.package_item_id
     and patient_package_id = new.patient_package_id;

  if already_used + new.quantity_used > included then
    raise exception 'الكمية المطلوبة (%) تتجاوز المتبقي في الباقة (المتاح: %)',
      new.quantity_used, included - already_used;
  end if;

  -- الخدمة داخل الباقة تخضع لنفس متطلّباتها السريرية خارجها. باقةٌ مدفوعة
  -- لا تجعل خدمةً غير ملائمة ملائمة.
  v_check := app_check_service_eligibility(v_item, sub.patient_id, null, 'execution');
  if not (v_check ->> 'ok')::boolean then
    select string_agg(value, ' — ') into v_blocks
      from jsonb_array_elements_text(v_check -> 'blocks');
    raise exception 'لا يمكن استهلاك هذه الخدمة لهذا المريض: %', v_blocks;
  end if;

  if new.used_by is null then
    new.used_by := auth.uid();
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) دالة الاستهلاك — تُعيد الرصيد المتبقّي والتنبيهات
--
-- الإدراج المباشر يبقى مسموحًا (الحارس فوقه)، لكن الشاشة تستدعي هذه الدالة
-- كي تعرض للموظف ما تبقّى وما يجب تجهيزه، بدل «تم» عارية.
-- ---------------------------------------------------------------------------
create or replace function app_consume_package_item(
  p_patient_package_id uuid,
  p_package_item_id    uuid,
  p_quantity           numeric default 1,
  p_appointment_id     uuid default null,
  p_note               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub        patient_packages%rowtype;
  v_item     uuid;
  v_included numeric;
  v_used     numeric;
  v_check    jsonb;
  v_id       uuid;
begin
  select * into sub from patient_packages where id = p_patient_package_id;
  if sub.id is null then
    raise exception 'الاشتراك غير موجود';
  end if;
  if not app_is_member(sub.organization_id) then
    raise exception 'لا صلاحية';
  end if;

  select pi.item_id, pi.quantity_included into v_item, v_included
    from package_items pi
   where pi.id = p_package_item_id and pi.package_id = sub.package_id;
  if v_item is null then
    raise exception 'هذا البند لا ينتمي إلى باقة هذا الاشتراك';
  end if;

  if p_appointment_id is not null and not exists (
       select 1 from appointments a
        where a.id = p_appointment_id
          and a.organization_id = sub.organization_id
          and a.patient_id = sub.patient_id
     ) then
    raise exception 'الموعد لا يخصّ هذا المريض';
  end if;

  -- الحارس على الجدول يتكفّل بالقفل والرصيد والملاءمة؛ لا نكرّرها هنا كي لا
  -- يفترق الفحصان مع الوقت.
  insert into patient_package_usages (patient_package_id, package_item_id, quantity_used,
                                      appointment_id, note, used_by)
  values (p_patient_package_id, p_package_item_id, p_quantity,
          p_appointment_id, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  select coalesce(sum(quantity_used), 0) into v_used
    from patient_package_usages
   where package_item_id = p_package_item_id and patient_package_id = p_patient_package_id;

  v_check := app_check_service_eligibility(v_item, sub.patient_id, null, 'execution');

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (sub.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'استهلاك من باقة',
          format('كمية %s، المتبقي %s', p_quantity, v_included - v_used),
          nullif(btrim(coalesce(p_note, '')), ''));

  return jsonb_build_object(
    'usage_id', v_id,
    'quantity_included', v_included,
    'quantity_used', v_used,
    'quantity_remaining', v_included - v_used,
    'warnings', v_check -> 'warnings'
  );
end;
$$;

revoke all on function app_consume_package_item(uuid, uuid, numeric, uuid, text) from public, anon;
grant execute on function app_consume_package_item(uuid, uuid, numeric, uuid, text) to authenticated;

comment on function app_consume_package_item(uuid, uuid, numeric, uuid, text) is
  'يسجّل استهلاك جلسة من باقة مريض، ويعيد الرصيد المتبقي وتنبيهات تحضير الخدمة.';

-- ---------------------------------------------------------------------------
-- 3) الباقة المنتهية لا تبقى «نشطة» في الشاشة
--
-- `v_patient_package_balances` تحسب `is_expired` وتعرض `status` كما هو، فباقة
-- انتهت أمس تظهر «نشطة ومنتهية» معًا. الحالة الفعّالة عمود واحد يُقرأ.
-- ---------------------------------------------------------------------------
-- `create or replace view` لا يقبل إدراج عمود في وسط القائمة، فيُسقط المنظور
-- ويُعاد بناؤه. لا شيء يعتمد عليه في القاعدة (الشاشة فقط تقرؤه).
drop view if exists v_patient_package_balances;
create view v_patient_package_balances as
select
  pp.id as patient_package_id,
  pp.organization_id,
  pp.patient_id,
  pt.name_ar as patient_name,
  pp.package_id,
  pk.name_ar as package_name,
  pp.status,
  pp.purchased_at,
  pp.expires_at,
  (pp.expires_at is not null and pp.expires_at < now()) as is_expired,
  case
    when pp.status <> 'active' then pp.status
    when pp.expires_at is not null and pp.expires_at < now() then 'expired'
    else 'active'
  end as effective_status,
  pi.id as package_item_id,
  pi.item_id,
  it.name_ar as item_name,
  pi.quantity_included,
  coalesce(sum(u.quantity_used), 0) as quantity_used,
  pi.quantity_included - coalesce(sum(u.quantity_used), 0) as quantity_remaining,
  it.requires_fasting,
  it.requires_consent,
  it.preparation_ar
from patient_packages pp
join patients pt on pt.id = pp.patient_id
join packages pk on pk.id = pp.package_id
join package_items pi on pi.package_id = pp.package_id
join items it on it.id = pi.item_id
left join patient_package_usages u
  on u.package_item_id = pi.id and u.patient_package_id = pp.id
group by pp.id, pp.organization_id, pp.patient_id, pt.name_ar, pp.package_id, pk.name_ar,
         pp.status, pp.purchased_at, pp.expires_at, pi.id, pi.item_id, it.name_ar,
         pi.quantity_included, it.requires_fasting, it.requires_consent, it.preparation_ar;

alter view v_patient_package_balances set (security_invoker = on);
revoke all on v_patient_package_balances from anon;
grant select on v_patient_package_balances to authenticated;

commit;
