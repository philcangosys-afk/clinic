-- =============================================================================
-- 0155_allergies_and_doctor_loop.sql
-- الحساسية الدوائية، وإغلاق حلقة الطبيب مع المختبر والأشعة والتأمين.
-- =============================================================================
--
-- فحصٌ لشاشة الطبيب بعين طبيبٍ يعمل في عيادة أثبت أنّ الهيكل سليم والنواقص
-- في **إغلاق الحلقة**: الطبيب يُرسل ولا يعود إليه شيء.
--
-- ١) **الحساسية الدوائية غير مهيكلة ولا تُحذِّر.** لا جدول لها في القاعدة
--    إطلاقًا، وفئتا `allergy_types` و`allergy_severity` مزروعتان في 0086 ولا
--    يقرؤهما سطرٌ واحد. الحساسية تُسجَّل بندًا في قائمة الأمراض المزمنة
--    بملاحظةٍ حرّة: لا دواء محدَّد ولا شدّة ولا نوع تفاعل. ووصف دواءٍ يتحسّس
--    منه المريض أخطر خطأ يمنعه نظام، وهذا النظام لا يمنعه.
--
-- ٢) **نتائج المختبر العادية لا تصل الطبيب.** `v_doctor_inbox` (0138) مبنيّ
--    على `radiology_orders` وحدها. فالقيمة الحرجة تصل، أمّا نتيجةٌ غير حرجة
--    وخطيرة — سكّر تراكميّ ٩٪ — فلا تصل أحدًا.
--
-- ٣) **قراءة الأشعة لا تظهر في الصندوق.** `findings` و`impression` عمودان في
--    `radiology_order_items`، والصندوق يعرض ملاحظة الفنّيّ وحدها.
--
-- ٤) **«طلباتي» لا وجود لها.** لوحة الطلبات إرسالٌ فقط: يطلب الطبيب تحليلًا
--    ولا يعرف أأُخذت العيّنة أم رُفض الطلب أم ما زال منتظرًا منذ ساعتين.
--
-- ٥) **الموافقة التأمينية المسبقة ليست بيد الطبيب**، وهو من يقرّر الإجراء
--    ويعرف مبرّره الطبيّ.
--
-- ٦) **لا إحالة داخلية بين الأطباء** تُسجِّل من أحال.
--
-- كل ما يلي إضافةٌ محضة: جدول جديد، وأعمدة تُلحق، ومنظورات ودوالّ جديدة.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- ١) حساسية المريض — مهيكلة، لا ملاحظة حرّة
--
-- الحساسية الدوائية تُربط بصنف الكتالوج حين يكون معروفًا (`item_id`)، وتبقى
-- نصًّا حين يذكر المريض دواءً ليس في الكتالوج. والاثنان يُفحصان عند الوصف.
--
-- **لا حذف:** حساسيةٌ سُجِّلت ثمّ تبيّن خطؤها تُوضَع `refuted` بسببها، ولا
-- تُمحى — نفيُها معلومةٌ طبية كإثباتها، ومحوُها يُعيد السؤال كل زيارة.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists patient_allergies (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  patient_id            uuid not null references patients(id) on delete cascade,

  allergen_kind         text not null default 'drug',
  -- الدواء بعينه من الكتالوج حين يكون معروفًا
  item_id               uuid references items(id),
  -- وما يذكره المريض حين لا يكون في الكتالوج (أو طعام أو مادّة)
  allergen_text         text,

  allergy_type_value_id uuid references lookup_values(id),
  severity_value_id     uuid references lookup_values(id),
  reaction              text,
  onset_date            date,

  status                text not null default 'active',
  resolved_at           timestamptz,
  resolved_reason       text,
  note                  text,

  recorded_by           uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint patient_allergies_kind_check check (
    allergen_kind in ('drug','food','environment','other')),
  constraint patient_allergies_status_check check (
    status in ('active','resolved','refuted')),
  -- لا حساسية بلا مُسبِّب: صفٌّ بلا صنفٍ ولا نصّ تحذيرٌ لا يقول ممّ يُحذَّر
  constraint patient_allergies_allergen_check check (
    item_id is not null or nullif(btrim(coalesce(allergen_text,'')),'') is not null),
  constraint patient_allergies_resolved_reason_check check (
    status = 'active' or nullif(btrim(coalesce(resolved_reason,'')),'') is not null)
);

comment on table patient_allergies is
  'حساسية المريض مهيكلة: الصنف أو نصّ المُسبِّب، ونوعها وشدّتها والتفاعل. تُفحص عند وصف الدواء.';

create index if not exists idx_patient_allergies_patient
  on patient_allergies (patient_id, status);
create index if not exists idx_patient_allergies_org
  on patient_allergies (organization_id, status);
create index if not exists idx_patient_allergies_item
  on patient_allergies (item_id) where item_id is not null;
-- حساسيةٌ واحدة نشطة لكل صنف: تكرارها يُظهر التحذير مرّتين فيُهمَل
create unique index if not exists uq_patient_allergy_active_item
  on patient_allergies (patient_id, item_id)
  where item_id is not null and status = 'active';

alter table patient_allergies enable row level security;

-- **القراءة لكل عضو، والكتابة لمن يملك السجلّ الطبيّ.** أكثر الجداول
-- السريرية في هذا المستودع تكتفي بـ`app_is_member` لأنّ الكتابة تمرّ بدالّة
-- تفحص الصلاحية. وهذا الجدول يُكتب مباشرةً من الشاشة، فلو اكتفى بالعضوية
-- لصار فحص الواجهة (`medical_records.write`) هو الحارس الوحيد — وحارسٌ في
-- المتصفّح ليس حارسًا. السياستان تُقرآن بـ«أو»، فالقراءة تبقى لكل عضو.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'patient_allergies'
                    and policyname = 'patient_allergies_read') then
    create policy patient_allergies_read on patient_allergies
      for select using (app_is_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'patient_allergies'
                    and policyname = 'patient_allergies_write') then
    create policy patient_allergies_write on patient_allergies
      for all
      using (app_is_member(organization_id)
             and app_has_permission(organization_id, 'medical_records.write'))
      with check (app_is_member(organization_id)
             and app_has_permission(organization_id, 'medical_records.write'));
  end if;
end $$;

create or replace function app_touch_patient_allergy()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_patient_allergies_touch on patient_allergies;
create trigger trg_patient_allergies_touch
  before update on patient_allergies
  for each row execute function app_touch_patient_allergy();


create or replace view v_patient_allergies
with (security_invoker = on) as
select
  a.id, a.organization_id, a.patient_id,
  a.allergen_kind, a.item_id, a.allergen_text,
  coalesce(i.name_ar, a.allergen_text) as allergen_label,
  d.generic_name,
  a.allergy_type_value_id, lt.name_ar as allergy_type_name,
  a.severity_value_id,     ls.name_ar as severity_name,
  a.reaction, a.onset_date,
  a.status, a.resolved_at, a.resolved_reason, a.note,
  a.recorded_by, a.created_at, a.updated_at
from patient_allergies a
left join items i        on i.id = a.item_id
left join drug_details d on d.item_id = a.item_id
left join lookup_values lt on lt.id = a.allergy_type_value_id
left join lookup_values ls on ls.id = a.severity_value_id;

comment on view v_patient_allergies is
  'حساسية المريض بأسماء الصنف والنوع والشدّة — قراءةٌ واحدة للشاشة وشريط الهوية.';

grant select on v_patient_allergies to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) فحص الحساسية عند وصف الدواء
--
-- **حدود هذا الفحص، وتُقال صراحةً:** مطابقةٌ بالصنف وبالاسم العلميّ وبالنصّ
-- الذي كتبه الطبيب — وليست محرّك تفاعلات متصالبة. حساسية البنسلين لا تُظهر
-- تحذيرًا على السيفالوسبورين، ولا يُدّعى ذلك. ومع هذا الحدّ يمنع الفحص أكثر
-- الأخطاء وقوعًا: وصف الدواء نفسه باسمٍ تجاريّ آخر.
--
-- تُعيد صفرًا أو أكثر: الصفر يعني «لا حساسية مسجَّلة»، لا «آمن».
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_check_drug_allergy(
  p_organization_id uuid,
  p_patient_id uuid,
  p_item_id uuid
)
returns table (
  allergy_id uuid,
  match_kind text,
  allergen_label text,
  severity_name text,
  reaction text,
  recorded_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_name    text;
  v_generic text;
  v_brand   text;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if p_patient_id is null or p_item_id is null then
    return;
  end if;

  select i.name_ar, d.generic_name, d.brand_name
    into v_name, v_generic, v_brand
    from items i
    left join drug_details d on d.item_id = i.id
   where i.id = p_item_id and i.organization_id = p_organization_id;
  if not found then
    return;
  end if;

  return query
  select a.id,
         case
           when a.item_id = p_item_id then 'same_item'
           when a.item_id is not null and ad.generic_name is not null
                and v_generic is not null
                and lower(btrim(ad.generic_name)) = lower(btrim(v_generic)) then 'same_generic'
           else 'text_match'
         end::text,
         coalesce(ai.name_ar, a.allergen_text)::text,
         ls.name_ar::text,
         a.reaction,
         a.created_at
    from patient_allergies a
    left join items ai        on ai.id = a.item_id
    left join drug_details ad on ad.item_id = a.item_id
    left join lookup_values ls on ls.id = a.severity_value_id
   where a.organization_id = p_organization_id
     and a.patient_id = p_patient_id
     and a.status = 'active'
     and a.allergen_kind = 'drug'
     and (
       a.item_id = p_item_id
       or (a.item_id is not null and ad.generic_name is not null and v_generic is not null
           and lower(btrim(ad.generic_name)) = lower(btrim(v_generic)))
       or (a.item_id is null
           and char_length(btrim(coalesce(a.allergen_text,''))) >= 3
           and (coalesce(v_name,'')    ilike '%' || btrim(a.allergen_text) || '%'
             or coalesce(v_generic,'') ilike '%' || btrim(a.allergen_text) || '%'
             or coalesce(v_brand,'')   ilike '%' || btrim(a.allergen_text) || '%'))
     )
   order by (case when a.item_id = p_item_id then 0 else 1 end), a.created_at;
end;
$$;

comment on function app_check_drug_allergy(uuid, uuid, uuid) is
  'حساسية المريض المطابقة لهذا الدواء: بالصنف أو الاسم العلميّ أو نصّ المُسبِّب. ليست محرّك تفاعلات متصالبة.';

revoke all on function app_check_drug_allergy(uuid, uuid, uuid) from public, anon;
grant execute on function app_check_drug_allergy(uuid, uuid, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) صندوق المختبر للطبيب الطالب
--
-- نظير `v_doctor_inbox` للأشعة. الشرط `status in (...)` يبدأ من `resulted`:
-- طلبٌ لم تُدخَل نتيجته بعد ليس بريدًا وصل، وإظهاره يُغرق الصندوق بما لا
-- يُقرأ فيُهمَل الصندوق كلّه.
-- ═══════════════════════════════════════════════════════════════════════════

drop view if exists v_doctor_lab_inbox;
create view v_doctor_lab_inbox
with (security_invoker = on) as
select
  o.id                    as order_id,
  o.organization_id,
  o.branch_id,
  o.ordering_doctor_id    as doctor_id,
  o.patient_id,
  p.name_ar               as patient_name,
  p.file_number,
  o.status,
  o.priority,
  o.ordered_at,
  o.completed_at,
  o.verified_at,
  count(oi.id)                                            as item_count,
  count(*) filter (where oi.result_value is not null)      as resulted_count,
  count(*) filter (where coalesce(oi.is_abnormal, false))  as abnormal_count,
  count(*) filter (where coalesce(oi.is_critical, false))  as critical_count,
  string_agg(distinct t.name_ar, ' • ')                    as test_names,
  max(oi.entered_at)                                       as last_result_at
from lab_orders o
join patients p on p.id = o.patient_id
join lab_order_items oi on oi.lab_order_id = o.id
left join lab_tests t on t.id = oi.lab_test_id
where o.status in ('resulted','verified','approved','delivered')
group by o.id, p.name_ar, p.file_number;

comment on view v_doctor_lab_inbox is
  'ما وصل الطبيب من المختبر: الطلبات التي أُدخلت نتائجها، بعدد الشاذّ والحرج منها.';

grant select on v_doctor_lab_inbox to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) قراءة الأشعة تُلحق بصندوق الأشعة
--
-- `create or replace view` تُلحق في النهاية ولا تُدرج في الوسط، فالأعمدة
-- الأربعة عشر أُعيدت كما هي حرفًا بحرف من 0138 والثلاثة الجديدة بعدها.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view v_doctor_inbox
with (security_invoker = on) as
select o.id                       as order_id,
       o.organization_id,
       o.branch_id,
       o.ordering_doctor_id       as doctor_id,
       o.patient_id,
       p.name_ar                  as patient_name,
       p.id_number                as patient_id_number,
       o.status,
       o.priority,
       o.images_ready_at,
       max(ri.created_at)         as last_image_at,
       count(ri.id)               as image_count,
       string_agg(distinct e.name_ar, ' • ') as exam_names,
       max(ri.note)               as tech_note,
       -- مُلحَق في 0155: قراءة أخصّائي الأشعة، لا ملاحظة الفنّيّ وحدها
       string_agg(distinct oi.findings,   E'\n') as findings,
       string_agg(distinct oi.impression, E'\n') as impression,
       bool_or(coalesce(oi.is_urgent_finding, false)) as has_urgent_finding
  from radiology_orders o
  join patients p on p.id = o.patient_id
  join radiology_order_items oi on oi.radiology_order_id = o.id
  join radiology_images ri on ri.radiology_order_item_id = oi.id
  left join radiology_exams e on e.id = oi.radiology_exam_id
 where o.status in ('images_ready','reporting','verified','delivered')
 group by o.id, p.name_ar, p.id_number;

comment on view v_doctor_inbox is
  'ما وصل الطبيب من قسم الأشعة: الصور، ومعها قراءة الأخصّائي وعلامة الاكتشاف العاجل.';


-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) «طلباتي وحالتها» — مصدرٌ واحد لكل ما أرسله الطبيب
--
-- كان الطبيب يُرسل ولا يعود إليه شيء: طلبُ تحليلٍ في جدول، وطلبُ مؤشّرات في
-- آخر، وطلبُ الاستقبال في ثالث، وموعدُ المتابعة في رابع — ولا شاشة تجمعها.
-- ═══════════════════════════════════════════════════════════════════════════

-- عمود المُحيل يسبق المنظور لأن المنظور يقرؤه. الإحالة نفسها في القسم ٧.
alter table appointment_requests
  add column if not exists referred_by_doctor_id uuid references doctors(id);

comment on column appointment_requests.referred_by_doctor_id is
  'الطبيب المُحيل حين يكون الطلب إحالة داخلية بين الأطباء.';

create index if not exists idx_appointment_requests_referrer
  on appointment_requests (referred_by_doctor_id, status)
  where referred_by_doctor_id is not null;

drop view if exists v_doctor_requests;
create view v_doctor_requests
with (security_invoker = on) as
select o.id, o.organization_id, o.ordering_doctor_id as doctor_id, o.patient_id,
       p.name_ar as patient_name, p.file_number,
       'lab'::text as kind, 'طلب تحليل'::text as kind_label,
       o.status, o.priority, o.ordered_at as requested_at,
       -- 0083 نقل دورة المختبر إلى resulted/approved/delivered، و`completed_at`
       -- لم يعد يُكتب. أحدث ما بلغه الطلب هو تاريخ إغلاقه.
       coalesce(o.delivered_at, o.approved_at, o.verified_at, o.resulted_at) as closed_at,
       null::text as body
  from lab_orders o join patients p on p.id = o.patient_id
 where o.ordering_doctor_id is not null
union all
select o.id, o.organization_id, o.ordering_doctor_id, o.patient_id,
       p.name_ar, p.file_number,
       'radiology', 'طلب أشعة',
       o.status, o.priority, o.ordered_at,
       coalesce(o.delivered_at, o.verified_at, o.images_ready_at), null
  from radiology_orders o join patients p on p.id = o.patient_id
 where o.ordering_doctor_id is not null
union all
select r.id, r.organization_id, r.doctor_id, r.patient_id,
       p.name_ar, p.file_number,
       'vitals', 'مؤشرات حيوية',
       r.status, r.priority, r.requested_at, r.recorded_at, r.note
  from vital_sign_requests r join patients p on p.id = r.patient_id
 where r.doctor_id is not null
union all
select s.id, s.organization_id, s.doctor_id, s.patient_id,
       p.name_ar, p.file_number,
       'staff', 'طلب للاستقبال',
       s.status, s.priority, s.requested_at, s.resolved_at, s.body
  from staff_requests s join patients p on p.id = s.patient_id
 where s.doctor_id is not null
union all
-- موعد المتابعة الذي طلبه الطبيب لمريضه. الإحالة مستثناة: هي طلبٌ لطبيبٍ
-- آخر، وتظهر في الفرع التالي لصاحبها لا للمُحال إليه.
select a.id, a.organization_id, a.doctor_id, a.patient_id,
       p.name_ar, p.file_number,
       'follow_up', 'موعد متابعة',
       a.status, null, a.created_at, a.decided_at, a.reason
  from appointment_requests a join patients p on p.id = a.patient_id
 where a.doctor_id is not null and a.referred_by_doctor_id is null
union all
-- الإحالة من جهة **المُحيل**: هو من أرسلها، فهي في «طلباتي» عنده.
select a.id, a.organization_id, a.referred_by_doctor_id, a.patient_id,
       p.name_ar, p.file_number,
       'referral', 'إحالة إلى زميل',
       a.status, null, a.created_at, a.decided_at, a.reason
  from appointment_requests a join patients p on p.id = a.patient_id
 where a.referred_by_doctor_id is not null;

comment on view v_doctor_requests is
  'كل ما أرسله الطبيب وحالته: تحاليل وأشعة ومؤشّرات وطلبات الاستقبال ومواعيد المتابعة والإحالات. الصفّ يُميَّز بـ(kind, id) لا بـid وحده.';

grant select on v_doctor_requests to authenticated;


-- الوجه المقابل: ما أُحيل **إلى** الطبيب. صندوقٌ وارد، لا «طلباتي».
drop view if exists v_doctor_referrals_in;
create view v_doctor_referrals_in
with (security_invoker = on) as
select a.id                     as request_id,
       a.organization_id,
       a.branch_id,
       a.doctor_id,
       a.referred_by_doctor_id,
       rd.name_ar               as referred_by_name,
       a.patient_id,
       p.name_ar                as patient_name,
       p.file_number,
       a.clinic_id,
       a.reason,
       a.preferred_date,
       a.status,
       a.appointment_id,
       a.decided_at,
       a.decision_note,
       a.created_at
  from appointment_requests a
  join patients p on p.id = a.patient_id
  left join doctors rd on rd.id = a.referred_by_doctor_id
 where a.referred_by_doctor_id is not null;

comment on view v_doctor_referrals_in is
  'ما أحاله الزملاء إلى هذا الطبيب: المريض والمُحيل وسببه وحالة الطلب.';

grant select on v_doctor_referrals_in to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) طلب موافقة تأمين مسبقة — من يد الطبيب
--
-- هو من يقرّر الإجراء ويعرف مبرّره الطبيّ، وكان يُملي المبرّر على موظّف
-- التأمين بالصوت.
--
-- الطلب يولد **مسوّدة** `draft` لا `pending`: الطبيب يطلب، وموظّف التأمين هو
-- من يُرسل إلى شركة التأمين. حالةٌ تقول «أُرسل» قبل الإرسال كذبٌ على الشاشة.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_request_preauthorization(
  p_organization_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_service_description text,
  p_doctor_id uuid default null,
  p_visit_id uuid default null,
  p_clinic_id uuid default null,
  p_qty numeric default 1,
  p_requested_amount numeric default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id         uuid;
  v_membership uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not app_has_role(p_organization_id, array['owner','organization_admin','doctor','branch_manager']) then
    raise exception 'صلاحيتك لا تسمح بطلب الموافقة المسبقة';
  end if;
  if nullif(btrim(coalesce(p_service_description,'')),'') is null then
    raise exception 'صف الخدمة المطلوب اعتمادها';
  end if;
  if not exists (select 1 from patients p
                  where p.id = p_patient_id and p.organization_id = p_organization_id) then
    raise exception 'المريض المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  -- **الصنف إلزاميّ.** 0089 أغلق ثقبًا كان فيه الطلب وصفًا نصًّا بلا معرّف،
  -- فكانت الموافقة عليه تفتح كلّ خدمة تشترط موافقة. لا يُعاد فتحه من هنا.
  if not exists (select 1 from items i
                  where i.id = p_item_id and i.organization_id = p_organization_id
                    and coalesce(i.is_archived, false) = false) then
    raise exception 'الخدمة المطلوب اعتمادها غير موجودة أو مؤرشفة';
  end if;

  -- عضوية التأمين النشطة تُستنبَط ولا تُطلب من الطبيب: هي بيانٌ إداريّ
  select m.id into v_membership
    from patient_insurance_memberships m
   where m.organization_id = p_organization_id
     and m.patient_id = p_patient_id
     and coalesce(m.is_active, true) = true
   order by m.created_at desc
   limit 1;

  insert into insurance_preauthorizations (
    organization_id, patient_id, membership_id, doctor_id, clinic_id, visit_id,
    item_id, qty, service_description, requested_amount, note,
    status, requested_at, created_by
  ) values (
    p_organization_id, p_patient_id, v_membership, p_doctor_id, p_clinic_id, p_visit_id,
    p_item_id, coalesce(p_qty, 1), btrim(p_service_description), p_requested_amount,
    nullif(btrim(p_note),''), 'draft', now(), auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

comment on function app_request_preauthorization(uuid, uuid, uuid, text, uuid, uuid, uuid, numeric, numeric, text) is
  'طلب موافقة مسبقة يبدأه الطبيب: الصنف إلزاميّ، والعضوية تُستنبَط، والحالة مسوّدة يرسلها موظّف التأمين.';

revoke all on function app_request_preauthorization(uuid, uuid, uuid, text, uuid, uuid, uuid, numeric, numeric, text)
  from public, anon;
grant execute on function app_request_preauthorization(uuid, uuid, uuid, text, uuid, uuid, uuid, numeric, numeric, text)
  to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) إحالة داخلية بين الأطباء
--
-- الإحالة طلبُ موعدٍ عند الطبيب الآخر، فلا جدول جديد لها — لكنّها كانت
-- تُفقد من أحال. العمود (المُضاف في القسم ٥ قبل المنظور الذي يقرؤه) يُسجّله،
-- فيُعرف لاحقًا من أحال ولماذا.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_refer_patient_to_doctor(
  p_organization_id uuid,
  p_patient_id uuid,
  p_to_doctor_id uuid,
  p_from_doctor_id uuid,
  p_reason text,
  p_preferred_date date default null,
  p_clinic_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'سبب الإحالة مطلوب — إحالةٌ بلا سبب تصل الزميل بلا سؤال';
  end if;
  if p_to_doctor_id = p_from_doctor_id then
    raise exception 'لا تُحال الحالة إلى الطبيب نفسه';
  end if;
  if not exists (select 1 from patients p
                  where p.id = p_patient_id and p.organization_id = p_organization_id) then
    raise exception 'المريض المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if not exists (select 1 from doctors d
                  where d.id = p_to_doctor_id and d.organization_id = p_organization_id
                    and d.is_enabled = true) then
    raise exception 'الطبيب المُحال إليه غير موجود أو معطَّل';
  end if;

  insert into appointment_requests (
    organization_id, patient_id, doctor_id, clinic_id,
    preferred_date, reason, status, source, referred_by_doctor_id
  ) values (
    p_organization_id, p_patient_id, p_to_doctor_id, p_clinic_id,
    p_preferred_date, btrim(p_reason), 'pending', 'doctor_referral', p_from_doctor_id
  ) returning id into v_id;

  return v_id;
end;
$$;

comment on function app_refer_patient_to_doctor(uuid, uuid, uuid, uuid, text, date, uuid) is
  'إحالة داخلية: طلب موعد عند طبيبٍ آخر مع تسجيل المُحيل وسببه.';

revoke all on function app_refer_patient_to_doctor(uuid, uuid, uuid, uuid, text, date, uuid)
  from public, anon;
grant execute on function app_refer_patient_to_doctor(uuid, uuid, uuid, uuid, text, date, uuid)
  to authenticated;

notify pgrst, 'reload schema';
