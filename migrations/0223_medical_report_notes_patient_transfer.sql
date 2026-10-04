-- ============================================================================
-- 0223_medical_report_notes_patient_transfer.sql
-- ============================================================================
-- طلب المالك (04/10/2026):
--
--   ١) «التقارير الطبية» بلونٍ مختلف، وتُنسخ لكلّ مريض تقاريره من Kizen:
--      تقارير Kizen (53 تقريرًا لـ37 مريضًا) تُنسخ إلى `medical_reports`
--      نفسه — لا جدول جديد — بعلامة المصدر:
--        • `source` = 'kizen' | 'zaincare'، و`kizen_key` (KZ-MR-SR-n / KZ-MR-SL-n)
--          فريدٌ في المنشأة، و`legacy_number` رقمه المطبوع في Kizen.
--        • `legacy_doctor_name` / `legacy_user_name` / `legacy_payload`: الطبيب
--          والمستخدم وكلّ حقول Kizen كما هي.
--        • تقرير Kizen لا يُلغى (أرشيف) — `app_cancel_medical_report` يرفضه.
--      البيانات نفسها لا تُكتب هنا (بيانات مرضى حقيقية خارج git):
--      `_import_patients/kizen_mr_1004/kizen_medical_reports_import.sql`.
--
--   ٢) «إضافة ملاحظة في التقرير وتُحفظ»: `medical_report_notes` — ملاحظاتٌ
--      تُلحق بتقريرٍ بعينه (ومنها تقارير Kizen)، بكاتبها ووقتها. لا تعديل
--      ولا حذف: الملحق الطبي يُضاف ولا يُمحى. `app_add_medical_report_note`.
--      (لا يصلح `patient_notes` لها: تلك تنبيهات الملف العامّة تظهر للاستقبال
--      بعدّادها، وهذه ملحقات تقريرٍ محدّد.)
--
--   ٣) «تحويل المريض إلى طبيب آخر — فيصير مفتوحًا عند الاثنين»:
--      `app_transfer_patient_to_doctor` يضيف الطبيب المحوَّل إليه (والمحوِّل
--      إن لم يكن طبيبه المعالج) إلى `patients.participating_doctor_ids`، وهو
--      ما يعتمد عليه `v_doctor_patients` (0164) في «مرضى الطبيب». ويكتب سطرًا
--      في ملاحظات الملف، وينبّه الطبيب المحوَّل إليه، ويسجّل في التدقيق.
--      للأطباء ولإدارة المنشأة. لا يُزال أيّ طبيب من الملف.
--
-- لا يمسّ الفواتير ولا ZATCA. معاملة واحدة، القفل أوّلًا، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';
lock table public.medical_reports in access exclusive mode;

-- ── ١) مصدر التقرير ─────────────────────────────────────────────────────────
alter table public.medical_reports add column if not exists source text not null default 'zaincare';
alter table public.medical_reports add column if not exists kizen_key text;
alter table public.medical_reports add column if not exists legacy_number integer;
alter table public.medical_reports add column if not exists legacy_doctor_name text;
alter table public.medical_reports add column if not exists legacy_user_name text;
alter table public.medical_reports add column if not exists legacy_payload jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'medical_reports_source_check'
                    and conrelid = 'public.medical_reports'::regclass) then
    alter table public.medical_reports
      add constraint medical_reports_source_check check (source in ('zaincare', 'kizen'));
  end if;
end $$;

create unique index if not exists uq_medical_reports_kizen_key
  on public.medical_reports (organization_id, kizen_key)
  where kizen_key is not null;

comment on column public.medical_reports.source is
  'zaincare = صدر من النظام، kizen = منسوخ من النظام السابق (للقراءة والملاحظات، لا يُلغى). 0223.';
comment on column public.medical_reports.legacy_number is
  'رقم التقرير المطبوع في Kizen (تسلسل لكلّ نوع). 0223.';

-- ── ٢) ملاحظات التقرير ──────────────────────────────────────────────────────
create table if not exists public.medical_report_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  report_id        uuid not null references public.medical_reports(id) on delete cascade,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  body             text not null,
  created_by       uuid references auth.users(id),
  created_by_name  text,
  created_at       timestamptz not null default now(),
  constraint medical_report_notes_body_check
    check (length(btrim(body)) between 1 and 4000)
);

comment on table public.medical_report_notes is
  'ملاحظاتٌ تُلحق بتقرير طبيّ بعينه (ومنها تقارير Kizen) بكاتبها ووقتها — تُضاف ولا تُعدَّل ولا تُحذف. 0223.';

create index if not exists idx_medical_report_notes_report
  on public.medical_report_notes (report_id, created_at);
create index if not exists idx_medical_report_notes_patient
  on public.medical_report_notes (patient_id);

alter table public.medical_report_notes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'medical_report_notes'
                    and policyname = 'medical_report_notes_member_read') then
    create policy medical_report_notes_member_read on public.medical_report_notes
      for select using (app_is_member(organization_id));
  end if;
end $$;

revoke all on public.medical_report_notes from anon;
grant select on public.medical_report_notes to authenticated;

create or replace function public.app_add_medical_report_note(p_report_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report medical_reports%rowtype;
  v_body   text := btrim(coalesce(p_body, ''));
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  select * into v_report from medical_reports where id = p_report_id;
  if not found then
    raise exception 'التقرير غير موجود';
  end if;
  if not app_is_member(v_report.organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not (app_has_role(v_report.organization_id, array['owner','organization_admin','doctor','branch_manager'])
          or app_has_permission(v_report.organization_id, 'medical_records.write')) then
    raise exception 'صلاحيتك لا تسمح بإضافة ملاحظة على التقرير الطبي';
  end if;
  if v_report.status = 'cancelled' then
    raise exception 'التقرير ملغى — لا تُضاف عليه ملاحظات';
  end if;
  if v_body = '' then
    raise exception 'اكتب نصّ الملاحظة';
  end if;
  if length(v_body) > 4000 then
    raise exception 'الملاحظة أطول من 4000 حرف';
  end if;

  insert into medical_report_notes (organization_id, report_id, patient_id, body, created_by, created_by_name)
  values (v_report.organization_id, v_report.id, v_report.patient_id, v_body, auth.uid(),
          app_member_user_name(v_report.organization_id, auth.uid()))
  returning id into v_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_report.organization_id, auth.uid(), 'medical_records', 'add', v_report.id,
          'ملاحظة على تقرير طبي',
          concat_ws(' · ', app_patient_label(v_report.patient_id),
                    'تقرير ' || coalesce(v_report.report_number::text, v_report.legacy_number::text, '—'),
                    left(v_body, 300)));

  return v_id;
end $$;

revoke all on function public.app_add_medical_report_note(uuid, text) from public, anon;
grant execute on function public.app_add_medical_report_note(uuid, text) to authenticated;

comment on function public.app_add_medical_report_note(uuid, text) is
  'يُلحق ملاحظة بتقرير طبيّ (للطبيب والإدارة) ويسجّلها في التدقيق. 0223.';

-- ── ٣) العرض: المصدر والملاحظات في آخره ─────────────────────────────────────
create or replace view public.v_medical_reports
with (security_invoker = on) as
select
  r.id, r.organization_id, r.branch_id, r.patient_id, r.visit_id, r.doctor_id,
  r.report_type, r.report_number, r.report_date,
  r.issued_to, r.medical_director_name, r.insurance_company_name,
  r.diagnosis_text, r.body,
  r.leave_start_date, r.leave_end_date, r.leave_days,
  r.referral_facility, r.referral_specialty_value_id,
  r.admission_at, r.discharge_at,
  r.status, r.cancel_reason, r.cancelled_at,
  r.created_by, r.created_at,
  p.name_ar        as patient_name,
  p.file_number    as patient_file_number,
  coalesce(d.name_ar, r.legacy_doctor_name) as doctor_name,
  lv.name_ar       as referral_specialty_name,
  r.source,
  r.kizen_key,
  r.legacy_number,
  r.legacy_user_name,
  r.legacy_payload,
  (select count(*) from medical_report_notes n where n.report_id = r.id)::integer as notes_count
from medical_reports r
join patients p on p.id = r.patient_id
left join doctors d on d.id = r.doctor_id
left join lookup_values lv on lv.id = r.referral_specialty_value_id;

grant select on public.v_medical_reports to authenticated;

-- ── ٤) تقرير Kizen لا يُلغى ─────────────────────────────────────────────────
create or replace function public.app_cancel_medical_report(
  p_report_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_org uuid;
  v_status text;
  v_source text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  select r.organization_id, r.status, r.source into v_org, v_status, v_source
    from medical_reports r where r.id = p_report_id;
  if not found then
    raise exception 'التقرير غير موجود';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not app_has_role(v_org, array['owner','organization_admin','doctor','branch_manager']) then
    raise exception 'صلاحيتك لا تسمح بإلغاء التقارير الطبية';
  end if;
  if v_source = 'kizen' then
    raise exception 'تقارير النظام السابق (Kizen) أرشيفٌ لا يُلغى — أضف عليه ملاحظة بدلًا من ذلك';
  end if;
  if v_status = 'cancelled' then
    raise exception 'التقرير ملغًى أصلًا';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'سبب الإلغاء مطلوب';
  end if;

  -- الرقم يبقى: تقريرٌ ملغًى برقمه أوضح من فجوة في التسلسل
  update medical_reports
     set status = 'cancelled',
         cancel_reason = btrim(p_reason),
         cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = p_report_id;
end;
$$;

revoke all on function public.app_cancel_medical_report(uuid, text) from public, anon;
grant execute on function public.app_cancel_medical_report(uuid, text) to authenticated;

-- ── ٥) تحويل المريض إلى طبيب آخر ────────────────────────────────────────────
create or replace function public.app_transfer_patient_to_doctor(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_to_doctor_id    uuid,
  p_note            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient   patients%rowtype;
  v_admin     boolean;
  v_from      uuid;
  v_from_name text;
  v_to_name   text;
  v_to_user   uuid;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_before    uuid[];
  v_after     uuid[];
  v_label     text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  v_admin := app_has_role(p_organization_id, array['owner','organization_admin','branch_manager']);
  if not (v_admin or app_has_role(p_organization_id, array['doctor'])) then
    raise exception 'تحويل المريض للأطباء وإدارة المنشأة';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'الملاحظة أطول من 1000 حرف';
  end if;

  select * into v_patient from patients
   where id = p_patient_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  select d.name_ar, d.user_id into v_to_name, v_to_user
    from doctors d
   where d.id = p_to_doctor_id and d.organization_id = p_organization_id
     and coalesce(d.is_enabled, true);
  if v_to_name is null then
    raise exception 'الطبيب المحوَّل إليه غير موجود أو معطّل';
  end if;

  -- المحوِّل: الطبيب المربوط بالحساب الداخل، وإلّا الطبيب المعالج
  select d.id, d.name_ar into v_from, v_from_name
    from doctors d
   where d.organization_id = p_organization_id and d.user_id = auth.uid()
     and coalesce(d.is_enabled, true)
   order by d.created_at nulls last
   limit 1;
  if v_from is null and v_patient.treating_doctor_id is not null then
    select d.id, d.name_ar into v_from, v_from_name
      from doctors d where d.id = v_patient.treating_doctor_id;
  end if;

  if v_from is not null and v_from = p_to_doctor_id then
    raise exception 'اختر طبيبًا غير المحوِّل';
  end if;

  -- الطبيب لا يحوّل إلّا مريضه (طبيبه المعالج، أو مشارك، أو له معه موعد/زيارة)
  if not v_admin then
    if v_from is null then
      raise exception 'حسابك غير مربوط ببطاقة طبيب — راجع الإدارة';
    end if;
    if not (v_patient.treating_doctor_id is not distinct from v_from
            or v_from = any (coalesce(v_patient.participating_doctor_ids, '{}'::uuid[]))
            or exists (select 1 from appointments a where a.patient_id = p_patient_id and a.doctor_id = v_from)
            or exists (select 1 from patient_visits v where v.patient_id = p_patient_id and v.doctor_id = v_from)) then
      raise exception 'لا يُحوَّل إلّا مريضٌ من مرضاك';
    end if;
  end if;

  v_before := coalesce(v_patient.participating_doctor_ids, '{}'::uuid[]);
  -- الإضافة لا الإزالة: المحوَّل إليه، والمحوِّل إن لم يكن الطبيب المعالج
  select coalesce(array_agg(x order by o), '{}'::uuid[]) into v_after
    from (
      select x, min(o) as o
        from unnest(v_before || array[p_to_doctor_id, v_from]) with ordinality as t(x, o)
       where x is not null
         and x is distinct from v_patient.treating_doctor_id
       group by x
    ) s;

  if v_after is distinct from v_before then
    update patients set participating_doctor_ids = v_after where id = p_patient_id;
  end if;

  v_label := app_patient_label(p_patient_id);

  -- سطرٌ في ملاحظات الملف: يراه الطبيبان والاستقبال
  insert into patient_notes (patient_id, title, body, created_by)
  values (p_patient_id,
          'تحويل إلى ' || v_to_name,
          'حُوِّل المريض' || coalesce(' من ' || v_from_name, '') || ' إلى ' || v_to_name
            || ' — صار ملفّه مفتوحًا عند الطبيبين.'
            || coalesce(E'\n' || v_note, ''),
          auth.uid());

  if v_to_user is not null then
    perform app_notify(
      p_organization_id, v_to_user, 'patient_transferred_to_doctor',
      'حُوِّل إليك مريض' || coalesce(' من ' || v_from_name, ''),
      'patient_transfer:' || p_patient_id::text || ':' || p_to_doctor_id::text || ':'
        || floor(extract(epoch from clock_timestamp()))::bigint::text,
      concat_ws(' · ', v_label, v_note),
      'clinical', 'info', 'patient', p_patient_id, '/patients/' || p_patient_id::text, null);
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'patients', 'update', p_patient_id,
          'تحويل مريض إلى طبيب آخر',
          concat_ws(' · ', v_label, coalesce(v_from_name, '—') || ' ← ' || v_to_name, v_note));

  return jsonb_build_object(
    'from_doctor_id', v_from,
    'from_doctor_name', v_from_name,
    'to_doctor_id', p_to_doctor_id,
    'to_doctor_name', v_to_name,
    'participating_doctor_ids', to_jsonb(v_after),
    'notified', v_to_user is not null);
end $$;

revoke all on function public.app_transfer_patient_to_doctor(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.app_transfer_patient_to_doctor(uuid, uuid, uuid, text) to authenticated;

comment on function public.app_transfer_patient_to_doctor(uuid, uuid, uuid, text) is
  'تحويل المريض إلى طبيب آخر: يُضاف إلى الأطباء المشاركين (مع المحوِّل) فيظهر عند الطبيبين، مع ملاحظة في الملف وتنبيه وتدقيق. 0223.';

commit;

notify pgrst, 'reload schema';

-- ── النتيجة ─────────────────────────────────────────────────────────────────
select 'التقارير الطبية' as "البند", count(*)::text as "العدد" from medical_reports
union all
select 'منها من Kizen', count(*)::text from medical_reports where source = 'kizen'
union all
select 'ملاحظات التقارير', count(*)::text from medical_report_notes
union all
select 'دالّة التحويل', case when to_regprocedure('public.app_transfer_patient_to_doctor(uuid,uuid,uuid,text)') is not null
                            then 'جاهزة' else 'مفقودة' end;
