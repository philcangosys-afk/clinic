-- ---------------------------------------------------------------------------
-- 0173 — مركز المتابعة، والطبيب لا يُصدر فاتورة
--
-- قرار المالك: **الفوترة للاستقبال وحده.** الطبيب لا يُنشئ فاتورةً من أيّ
-- شاشة — لا «إنشاء فاتورة» ولا «فاتورة بخصم». وما كان يقوله بالفاتورة («خصم
-- عشرة»، «مجانيّ»، «يدفع كاملًا») يقوله الآن **بكلمة** تصل الاستقبال فورًا.
--
-- ── ١) إلغاء فوترة الطبيب ──────────────────────────────────────────────────
--
--   • `app_create_sales_invoice`: يُنزع فرع الطبيب الذي أضافته 0170 ويعود فحص
--     الدور إلى صورته قبلها حرفًا بحرف — فالطبيب يُرفض كما كان يُرفض.
--   • `app_create_invoice_from_visit`: كانت تكتفي بـ`billing.issue`، فطبيبٌ
--     مُنحها يدويًّا كان يُفوتِر من الزيارة. تُضاف رفضةٌ للدور نفسه.
--   • `billing.doctor_invoice` تُنزع من الكتالوج ومن كلّ من مُنحها، و
--     `v_doctor_issued_invoices` يُحذف: منظورٌ لا يُنتج صفًّا بعد اليوم.
--   • وصلاحيّتا الخصم والمجانيّ تُنزعان من **افتراض دور الطبيب** (0167): لا
--     تعملان إلّا في فاتورة، والطبيب لا يُصدرها.
--
--   الفواتير التي أصدرها أطباء قبل اليوم **لا تُمَسّ** — تبقى بمبالغها
--   وأسبابها وأسماء من أصدرها.
--
-- ── ٢) مركز المتابعة ───────────────────────────────────────────────────────
--
--   الطبيب يختار مريضه ويكتب ملاحظةً ← تصل الاستقبال فورًا بنافذةٍ جانبية
--   وصوت ← والاستقبال يرى كلّ ما وصل من الأطباء، اليومَ افتراضًا، ويُرشّح
--   بالطبيب والتاريخ.
--
--   **لا جدول جديد.** الملاحظة صفٌّ في `staff_requests` بنوع `note` — النوع
--   القائم منذ 0138 — فتظهر أيضًا في «طلبات الأطباء» على لوحة الاستقبال كما
--   كانت. والمركز يقرأ **كلّ** ما يأتي من الأطباء: الملاحظة، واستدعاء المريض،
--   وطلب التحصيل، وطلب موعد المتابعة.
--
--   والجديد عمودان: `seen_at` و`seen_by` — **مَن اطّلع ومتى**. بهما تعرف
--   النافذة ما لم يُرَ بعد، ويعرف الطبيب أنّ رسالته قُرئت. «اطّلعت» غير
--   «تمّ»: طلب تحصيلٍ يُقرأ الآن ويُحصَّل بعد ساعة.
--
--   **والإرسال باسم الطبيب لا باسم من يضغط.** الطبيب المربوط حسابه ببطاقته
--   يُرسل باسمه وحده، ولمرضاه وحدهم. والمالك أو المدير يُرسل باسم طبيبٍ
--   يختاره — وهذا مخرج المعاينة بالأدوار، لا بابٌ لغيرهما.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١-أ) `app_create_sales_invoice` — نزعُ فرع الطبيب
--
-- قصٌّ بين علامتين لا استبدالُ نصٍّ طويل: الفرع ثلاثون سطرًا، ومطابقتها
-- حرفيًّا تفشل لفرقِ مسافةٍ واحدة. العلامتان سطران فريدان — أوّل الفرع
-- وآخره — وما بينهما يُستبدل بالسطر الذي كان هناك قبل 0170.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_src    text;
  v_new    text;
  v_start  int;
  v_end    int;
  m_start  text := '    -- ── الطبيب: بصلاحيةٍ مستقلّة، ولمريضه، وباسمه، وبلا قبضِ مال (0170) ──';
  m_end    text := '''الطبيب يُصدر الفاتورة ولا يُحصّلها — التحصيل من الاستقبال'';
    end if;
';
  v_back   text := '    raise exception ''صلاحيتك لا تسمح بإصدار الفواتير'';
';
begin
  -- اللصق عبر الحافظة يُدخل chr(13) على هذه النصوص دون مصدر الدالّة المخزَّن.
  m_start := replace(m_start, chr(13), '');
  m_end   := replace(m_end,   chr(13), '');
  v_back  := replace(v_back,  chr(13), '');

  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_sales_invoice'
   order by p.oid desc
   limit 1;
  if v_src is null then
    raise exception 'app_create_sales_invoice غير موجودة';
  end if;

  v_start := position(m_start in v_src);
  if v_start = 0 then
    if position('billing.doctor_invoice' in v_src) > 0 then
      raise exception 'app_create_sales_invoice: فرع الطبيب موجودٌ بصيغةٍ غير متوقَّعة — لم يُمَسّ شيء';
    end if;
    raise notice 'app_create_sales_invoice: لا فرعَ للطبيب فيها — تُخطّى';
    return;
  end if;

  v_end := position(m_end in v_src);
  if v_end = 0 or v_end < v_start then
    raise exception 'app_create_sales_invoice: تعذّر العثور على نهاية فرع الطبيب';
  end if;
  v_end := v_end + length(m_end);

  v_new := substr(v_src, 1, v_start - 1) || v_back || substr(v_src, v_end);
  -- المتغيّر الذي أعلنته 0170 لم يعد له استعمال
  v_new := replace(v_new, replace('
  v_self_doctor  uuid;', chr(13), ''), '');

  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١-ب) `app_create_invoice_from_visit` — الطبيب يُرفض ولو مُنح billing.issue
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_src    text;
  v_new    text;
  v_anchor text := '    raise exception ''صلاحيتك لا تسمح بإصدار الفواتير (billing.issue)'';
  end if;
';
  v_add    text := '
  -- الطبيب لا يُصدر فاتورة ولو مُنح billing.issue (0173): الفوترة للاستقبال،
  -- وتوجيهُ الطبيب يصل من مركز المتابعة.
  if app_has_role(v_visit.organization_id, array[''doctor'']) then
    raise exception ''الطبيب لا يُصدر الفواتير — أرسل توجيهك إلى الاستقبال من مركز المتابعة'';
  end if;
';
begin
  v_anchor := replace(v_anchor, chr(13), '');
  v_add    := replace(v_add,    chr(13), '');

  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_invoice_from_visit'
   order by p.oid desc
   limit 1;
  if v_src is null then
    raise notice 'app_create_invoice_from_visit غير موجودة — تُخطّى';
    return;
  end if;
  if position('مركز المتابعة' in v_src) > 0 then
    return; -- مُرقَّعة سلفًا
  end if;

  v_new := replace(v_src, v_anchor, v_anchor || v_add);
  if v_new = v_src then
    raise exception 'app_create_invoice_from_visit: تعذّر العثور على فحص billing.issue';
  end if;
  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١-ج) الصلاحية والمنظور
-- ═══════════════════════════════════════════════════════════════════════════
drop view if exists v_doctor_issued_invoices;

delete from membership_permissions   where permission_key = 'billing.doctor_invoice';
delete from role_default_permissions where permission_key = 'billing.doctor_invoice';
delete from permission_catalog       where permission_key = 'billing.doctor_invoice';

-- الخصم والمجانيّ لا يعملان إلّا في فاتورة — والطبيب لا يُصدرها
delete from role_default_permissions
 where role_key = 'doctor'
   and permission_key in ('billing.complimentary', 'billing.line_discount');

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢-أ) الميزة
-- ═══════════════════════════════════════════════════════════════════════════
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'follow_up_center', 'مركز المتابعة', 'Follow-up Center', 'الاستقبال والمواعيد', true, 21
where not exists (select 1 from feature_catalog where feature_key = 'follow_up_center');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'follow_up_center', true from organizations o
on conflict (organization_id, feature_key) do nothing;

update organization_features set enabled = true
 where feature_key = 'follow_up_center' and enabled is distinct from true;

-- المنشآت الجديدة. **وهذا ليس تجميلًا:** `app_create_medical_center` (0121)
-- ترفض الإنشاء إن لم تُفعَّل كلّ ميزات الكتالوج — فميزةٌ في الكتالوج لا
-- تُفعّلها دالّة التهيئة تكسر تسجيل كلّ منشأةٍ جديدة.
do $$
declare v_src text; v_new text;
begin
  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_after_organization_created';
  if v_src is null then
    raise notice 'app_after_organization_created غير موجودة — تُخطّى';
    return;
  end if;
  if position('''follow_up_center''' in v_src) > 0 then
    return; -- مُدرَجة سلفًا
  end if;
  v_new := replace(v_src, '''audit_log'',''settings''',
                          '''audit_log'',''settings'',''follow_up_center''');
  if v_new = v_src then
    raise exception 'تعذّر إدراج ميزة مركز المتابعة في دالّة تهيئة المنشأة';
  end if;
  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢-ب) الصلاحيات
--
-- النظر للطبيب والاستقبال ومدير الفرع؛ والإرسال للطبيب. أمّا الاطّلاع
-- والإقفال فبالصلاحية القائمة `reception.requests` (0138) — صلاحيةٌ ثانية
-- لعملٍ واحد تُربك شاشة الصلاحيات ولا تحمي شيئًا.
-- ═══════════════════════════════════════════════════════════════════════════
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
select v.k, v.n, 'follow_up_center', v.d, v.o
from (values
  ('follow_up_center.view', 'عرض مركز المتابعة',
   'فتح مركز المتابعة: ما يرسله الأطباء إلى الاستقبال', 2150),
  ('follow_up_center.send', 'إرسال إشعار إلى الاستقبال',
   'الطبيب يختار مريضه ويكتب ملاحظةً تصل الاستقبال فورًا', 2151)
) as v(k, n, d, o)
where not exists (select 1 from permission_catalog c where c.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('doctor',         'follow_up_center.view'),
  ('doctor',         'follow_up_center.send'),
  ('receptionist',   'follow_up_center.view'),
  ('branch_manager', 'follow_up_center.view')
) as v(r, p)
where not exists (
  select 1 from role_default_permissions d
   where d.role_key = v.r and d.permission_key = v.p
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢-ج) مَن اطّلع ومتى
-- ═══════════════════════════════════════════════════════════════════════════
alter table staff_requests
  add column if not exists seen_at timestamptz,
  add column if not exists seen_by uuid references auth.users(id);

alter table appointment_requests
  add column if not exists seen_at timestamptz,
  add column if not exists seen_by uuid references auth.users(id);

-- «ما وصل اليوم» و«ما لم يُرَ» هما سؤالا المركز والنافذة
create index if not exists idx_staff_requests_org_requested
  on staff_requests (organization_id, requested_at desc);
create index if not exists idx_appt_requests_doctor_created
  on appointment_requests (organization_id, created_at desc)
  where source = 'doctor';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢-د) المنظور
--
-- مصدران في صفٍّ واحد لأنّ القارئ واحد: `staff_requests` (ملاحظة، استدعاء،
-- تحصيل) و`appointment_requests` من الطبيب (موعد متابعة). كلّ طلبٍ يبقى في
-- جدوله وتُدار حالته من شاشته — والمنظور يجمعهما وقت القراءة.
--
-- والأسماء من `v_organization_members_directory` لا من `auth.users`: منظورٌ
-- بـ`security_invoker` لا يقرأ `auth.users` (0163).
-- ═══════════════════════════════════════════════════════════════════════════
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
  sr.resolution_note
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
  ar.decision_note
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

comment on view v_follow_up_center is
  'كلّ ما يرسله الأطباء إلى الاستقبال في صفٍّ واحد: الملاحظة والاستدعاء والتحصيل وموعد المتابعة، ومَن اطّلع ومتى، ومَن أقفل.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢-هـ) الإرسال
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_send_follow_up_note(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_body            text,
  p_doctor_id       uuid default null,
  p_priority        text default 'routine',
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_self   uuid;
  v_doctor uuid;
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_id     uuid;
  v_doc    text;
  v_pat    text;
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
  if v_body is null then
    raise exception 'اكتب الملاحظة';
  end if;
  if length(v_body) > 1000 then
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
    -- غير المربوط: المالك والمدير وحدهما، باسم طبيبٍ يختارانه (المعاينة)
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

  insert into staff_requests (organization_id, branch_id, request_type, patient_id,
                              doctor_id, body, priority, requested_by)
  values (p_organization_id, p_branch_id, 'note', p_patient_id,
          v_doctor, v_body, coalesce(p_priority, 'routine'), auth.uid())
  returning id into v_id;

  select name_ar into v_doc from doctors  where id = v_doctor;
  select name_ar into v_pat from patients where id = p_patient_id;

  -- الجرس أيضًا: من لم تكن النافذة مفتوحةً أمامه يجدها هناك
  perform app_notify_event(
    p_organization_id, 'staff_request_created',
    'ملاحظة من ' || coalesce(v_doc, 'طبيب'),
    'staff_req:' || v_id::text,
    coalesce(v_pat, '') || ' — ' || left(v_body, 120),
    'staff_request', v_id, '/follow-up-center', p_branch_id);

  return v_id;
end;
$$;

revoke all on function app_send_follow_up_note(uuid, uuid, text, uuid, text, uuid) from public, anon;
grant execute on function app_send_follow_up_note(uuid, uuid, text, uuid, text, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢-و) «اطّلعت»
--
-- تقبل قائمةً لا صفًّا: النافذة تعرض ما وصل مجتمعًا، و«اطّلعت على الكلّ»
-- نداءٌ واحد لا عشرة. وما اطُّلع عليه لا يُعاد ختمه — فالاسم الباقي اسمُ
-- أوّل من رأى.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_mark_follow_up_seen(
  p_organization_id uuid,
  p_staff_ids       uuid[] default '{}',
  p_appointment_ids uuid[] default '{}'
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a int := 0;
  v_b int := 0;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'reception.requests') then
    raise exception 'صلاحيتك لا تسمح باستقبال طلبات الأطباء (reception.requests)';
  end if;

  update staff_requests
     set seen_at = now(), seen_by = auth.uid(), updated_at = now()
   where organization_id = p_organization_id
     and id = any(coalesce(p_staff_ids, '{}'))
     and seen_at is null;
  get diagnostics v_a = row_count;

  update appointment_requests
     set seen_at = now(), seen_by = auth.uid(), updated_at = now()
   where organization_id = p_organization_id
     and id = any(coalesce(p_appointment_ids, '{}'))
     and seen_at is null;
  get diagnostics v_b = row_count;

  return v_a + v_b;
end;
$$;

revoke all on function app_mark_follow_up_seen(uuid, uuid[], uuid[]) from public, anon;
grant execute on function app_mark_follow_up_seen(uuid, uuid[], uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢-ز) البثّ الفوريّ
--
-- النافذة تنتظر حدث الإدراج لا دورةَ الاستطلاع. وسياسات RLS تسري على البثّ
-- كما تسري على القراءة: لا يصل عضوَ منشأةٍ حدثٌ من منشأةٍ أخرى.
-- وإن غاب النشر فالنافذة تعمل بالاستطلاع وحده — أبطأ، لكن لا يضيع شيء.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_all boolean;
  t     text;
begin
  select puballtables into v_all from pg_publication where pubname = 'supabase_realtime';
  if not found then
    raise notice 'لا نشر باسم supabase_realtime — التنبيه يعمل بالاستطلاع الدوريّ';
    return;
  end if;
  if v_all then
    return; -- النشر يشمل كلّ الجداول
  end if;
  foreach t in array array['staff_requests', 'appointment_requests'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- حرسٌ ختاميّ — ترقيةٌ نجحت نصفًا أسوأ من ترقيةٍ فشلت
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_src text;
begin
  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_sales_invoice'
   order by p.oid desc limit 1;
  if position('billing.doctor_invoice' in v_src) > 0
     or position('v_self_doctor' in v_src) > 0 then
    raise exception 'app_create_sales_invoice ما زالت تقبل الطبيب';
  end if;
  if position('صلاحيتك لا تسمح بإصدار الفواتير' in v_src) = 0 then
    raise exception 'app_create_sales_invoice فقدت فحص الدور';
  end if;

  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_invoice_from_visit'
   order by p.oid desc limit 1;
  if v_src is not null and position('مركز المتابعة' in v_src) = 0 then
    raise exception 'app_create_invoice_from_visit لا ترفض الطبيب';
  end if;

  if exists (select 1 from permission_catalog where permission_key = 'billing.doctor_invoice') then
    raise exception 'billing.doctor_invoice ما زالت في الكتالوج';
  end if;

  if exists (select 1 from organizations o
              where not exists (select 1 from organization_features f
                                 where f.organization_id = o.id
                                   and f.feature_key = 'follow_up_center'
                                   and f.enabled)) then
    raise exception 'منشأةٌ بلا مركز متابعة مفعَّل';
  end if;

  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_after_organization_created';
  if v_src is not null and position('''follow_up_center''' in v_src) = 0 then
    raise exception 'دالّة تهيئة المنشأة لا تفعّل مركز المتابعة — تسجيل المنشآت الجديدة سينكسر';
  end if;

  if pg_get_viewdef('v_follow_up_center'::regclass, true) ilike '%auth.users%' then
    raise exception 'v_follow_up_center يقرأ auth.users';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- بعد التشغيل
--
--   select permission_key from permission_catalog
--    where permission_key like 'follow_up_center.%' or permission_key = 'billing.doctor_invoice';
--   -- يجب: follow_up_center.send و follow_up_center.view — ولا billing.doctor_invoice
--
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename in ('staff_requests','appointment_requests');
--   -- يجب: الجدولان (إلّا إن كان النشر لكلّ الجداول)
-- ---------------------------------------------------------------------------
