-- ============================================================================
-- 0211 — سجلّ إجراءات الأسنان (منطق Kizen) فوق مخطّط الحالات
-- ----------------------------------------------------------------------------
-- المشكلة:
--   عيادة الأسنان في ZainCare مخطّطُ حالات + خطّة علاج مسعّرة. أمّا قلب Kizen
--   فسجلّ إجراءات بالزيارة: أسنان (واحد أو أكثر، أو هدف كالفكّ كاملًا أو
--   الأشعة) + شكوى + تشخيص + إجراء + تخدير/مضاعفات/مضادّات/تثقيف + ملاحظة +
--   الزيارة التالية، بطبيبه وتاريخه. وزيارات Kizen القديمة (legacy_patient_records
--   نوع dental_visit) لا تظهر إلّا في «أرشيف النظام السابق».
--
-- الجدول القائم لهذا الغرض: `dental_chart_entries` (0006) — بالحقول نفسها
-- حرفيًّا (أسنان متعدّدة، نوعها، الشكوى، الإجراء، ICD10، المضاعفات، التخدير،
-- المضادّات، التثقيف، أشعة/تقويم/فكّ كامل، الزيارة التالية، ملاحظة). كان
-- مربوطًا بزيارةٍ عامّة إلزاميًّا (صفّ لكلّ زيارة يكتبه app_save_visit). هنا
-- يصير سجلًّا مستقلًّا للمريض أيضًا — **بلا جدولٍ جديد**:
--   • visit_id اختياريّ؛ والصفّ المستقلّ يحمل المنشأة والمريض والطبيب وتاريخ
--     الزيارة. app_save_visit يحذف صفوف زيارته فقط (visit_id = زيارته)، فلا
--     يمسّ السجلّ المستقلّ.
--   • أهداف Kizen الباقية: الفكّ العلويّ، السفليّ، التقويم.
--   • التشخيص نصًّا حرًّا (كما في Kizen) مع كود ICD10 اختياريّ.
--   • الحذف إلغاءٌ بسبب (لا حذف نهائيّ)، والتعديل يُسقط توقيع المريض.
--   • توقيع المريض على الإجراء (صورة PNG كتوقيع الاتفاقية 0208).
--
-- المنظور `v_patient_dental_log` يجمع للمريض في جدولٍ واحد:
--   ١) السجلّ (المستقلّ وصفوف الزيارات القديمة)،
--   ٢) إجراءات خطّة العلاج المنفَّذة (tooth_procedures completed)،
--   ٣) زيارات الأسنان من Kizen (للقراءة) — بلا نقلها إلى جدولٍ آخر.
--
-- لا يمسّ الفواتير ولا ZATCA ولا خطّة العلاج. آمنة للتكرار.
--
-- معاملةٌ واحدة: يُقفل dental_chart_entries أوّلًا ثمّ تجري كلّ التعديلات، فلا
-- تتشابك الأقفال مع قراءات النظام الحيّ (deadlock 40P01). مهلة القفل 8 ثوانٍ:
-- إن كان الجدول مشغولًا تفشل كلّها بلا أثر، فتُعاد بعد لحظات.
-- ============================================================================

begin;
set local lock_timeout = '8s';
lock table dental_chart_entries in access exclusive mode;

-- ── ١) الأعمدة ──────────────────────────────────────────────────────────────
alter table dental_chart_entries alter column visit_id drop not null;

alter table dental_chart_entries
  add column if not exists organization_id   uuid references organizations(id) on delete cascade,
  add column if not exists patient_id        uuid references patients(id) on delete cascade,
  add column if not exists branch_id         uuid references branches(id),
  add column if not exists doctor_id         uuid references doctors(id),
  add column if not exists visit_date        date,
  add column if not exists diagnosis_text    text,
  add column if not exists upper_arch        boolean not null default false,
  add column if not exists lower_arch        boolean not null default false,
  add column if not exists orthodontics      boolean not null default false,
  add column if not exists updated_by        uuid references auth.users(id),
  add column if not exists is_cancelled      boolean not null default false,
  add column if not exists cancelled_at      timestamptz,
  add column if not exists cancelled_by      uuid references auth.users(id),
  add column if not exists cancel_reason     text,
  add column if not exists patient_signature text,
  add column if not exists patient_signed_at timestamptz,
  add column if not exists patient_signed_by uuid references auth.users(id);

-- صفوف الزيارات القديمة: المنشأة والمريض والطبيب والتاريخ من زيارتها
update dental_chart_entries d
   set organization_id = v.organization_id,
       patient_id      = v.patient_id,
       doctor_id       = coalesce(d.doctor_id, v.doctor_id),
       visit_date      = coalesce(d.visit_date, (coalesce(v.visit_date, v.created_at) at time zone 'Asia/Riyadh')::date)
  from patient_visits v
 where v.id = d.visit_id
   and (d.organization_id is null or d.patient_id is null or d.visit_date is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dental_chart_entries_owner_check') then
    alter table dental_chart_entries add constraint dental_chart_entries_owner_check
      check (visit_id is not null or (organization_id is not null and patient_id is not null));
  end if;
end $$;

create index if not exists idx_dental_chart_patient
  on dental_chart_entries (patient_id, visit_date desc, created_at desc);

-- قراءة السجلّ المستقلّ لأعضاء المنشأة (سياسة الزيارة القائمة تبقى لصفوف الزيارات)
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'dental_chart_entries' and policyname = 'dental_chart_entries_org_read') then
    create policy dental_chart_entries_org_read on dental_chart_entries
      for select using (organization_id is not null and app_is_member(organization_id));
  end if;
end $$;

-- ── ٢) تشخيصات الأسنان الخمسة عشر من Kizen (ما ينقص منها) ──────────────────
insert into icd10_codes (code, diagnosis_group, name_en, name_ar)
select v.code, v.grp, v.en, v.ar
  from (values
  ('B00.2', 'Dental', 'Herpesviral gingivostomatitis and pharyngotonsillitis', 'التهاب اللثة والفم الهربسي'),
    ('B02',   'Dental', 'Zoster [herpes zoster]', 'الحزام الناري'),
    ('B37.0', 'Dental', 'Candidal stomatitis', 'التهاب الفم المبيضّي (السُّلاق)'),
    ('K01.1', 'Dental', 'Impacted teeth', 'أسنان منحشرة'),
    ('K02',   'Dental', 'Dental caries', 'تسوّس الأسنان'),
    ('K04.0', 'Dental', 'Pulpitis', 'التهاب اللب'),
    ('K04.5', 'Dental', 'Chronic apical periodontitis', 'التهاب دواعم ذروي مزمن'),
    ('K04.6', 'Dental', 'Periapical abscess with sinus', 'خراج حول ذروي مع ناسور'),
    ('K05',   'Dental', 'Gingivitis and periodontal diseases', 'التهاب اللثة وأمراض دواعم السن'),
    ('K05.3', 'Dental', 'Chronic periodontitis', 'التهاب دواعم السن المزمن'),
    ('K07.6', 'Dental', 'Temporomandibular joint disorders', 'اضطرابات المفصل الصدغي الفكّي'),
    ('K08.3', 'Dental', 'Retained dental root', 'جذر سنّ متبقٍّ'),
    ('K11.5', 'Dental', 'Sialolithiasis', 'حصى الغدد اللعابية'),
    ('K12',   'Dental', 'Stomatitis and related lesions', 'التهاب الفم والآفات المتعلّقة به'),
    ('Z01.2', 'Dental', 'Dental examination', 'فحص الأسنان')
  ) as v(code, grp, en, ar)
 where not exists (select 1 from icd10_codes c where c.code = v.code);

-- ── ٣) الحفظ (جديد أو تعديل) ───────────────────────────────────────────────
create or replace function app_save_dental_procedure(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_payload         jsonb,
  p_entry_id        uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type    text := coalesce(nullif(p_payload ->> 'tooth_type', ''), 'permanent');
  v_teeth   text[];
  v_bad     text;
  v_doctor  uuid;
  v_date    date := coalesce(nullif(p_payload ->> 'visit_date', '')::date,
                             (now() at time zone 'Asia/Riyadh')::date);
  v_icd     uuid := nullif(p_payload ->> 'diagnosis_icd10_id', '')::uuid;
  v_old     dental_chart_entries%rowtype;
  v_id      uuid;
  v_targets boolean;
  t         text := '';
  f         record;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بتسجيل الإجراءات الطبية (medical_records.write)';
  end if;
  if not exists (select 1 from patients where id = p_patient_id and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;
  if v_type not in ('permanent', 'primary') then
    raise exception 'نوع الأسنان إمّا دائمة أو لبنية';
  end if;

  select coalesce(array_agg(distinct btrim(x)), '{}') into v_teeth
    from jsonb_array_elements_text(coalesce(p_payload -> 'teeth', '[]'::jsonb)) x
   where btrim(x) <> '';
  select x into v_bad from unnest(v_teeth) x
   where not (case when v_type = 'primary' then x ~ '^[5-8][1-5]$' else x ~ '^[1-4][1-8]$' end)
   limit 1;
  if v_bad is not null then
    raise exception 'رقم سنّ غير صالح (%) — الأسنان %', v_bad,
      case when v_type = 'primary' then 'اللبنية 51–85' else 'الدائمة 11–48' end;
  end if;

  v_targets := coalesce((p_payload ->> 'is_xray')::boolean, false)
            or coalesce((p_payload ->> 'full_arch')::boolean, false)
            or coalesce((p_payload ->> 'upper_arch')::boolean, false)
            or coalesce((p_payload ->> 'lower_arch')::boolean, false)
            or coalesce((p_payload ->> 'ortho_upper')::boolean, false)
            or coalesce((p_payload ->> 'ortho_lower')::boolean, false)
            or coalesce((p_payload ->> 'orthodontics')::boolean, false);
  if cardinality(v_teeth) = 0 and not v_targets then
    raise exception 'اختر سنًّا أو أكثر، أو هدفًا (الفكّ كاملًا، العلويّ، السفليّ، أشعة، تقويم)';
  end if;

  if coalesce(nullif(btrim(p_payload ->> 'main_complaint'), ''), nullif(btrim(p_payload ->> 'diagnosis_text'), ''),
              nullif(btrim(p_payload ->> 'procedure_done'), ''), nullif(btrim(p_payload ->> 'note'), '')) is null
     and v_icd is null then
    raise exception 'اكتب الشكوى أو التشخيص أو الإجراء أو ملاحظة';
  end if;
  if v_date > (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'تاريخ الزيارة في المستقبل';
  end if;
  if v_icd is not null and not exists (select 1 from icd10_codes where id = v_icd) then
    raise exception 'كود ICD10 غير معروف';
  end if;

  -- الطبيب: صاحب الحساب إن كان طبيبًا، وإلّا من يُختار
  select d.id into v_doctor from doctors d
   where d.organization_id = p_organization_id and d.user_id = auth.uid()
     and coalesce(d.is_enabled, true)
   limit 1;
  if v_doctor is null then
    v_doctor := nullif(p_payload ->> 'doctor_id', '')::uuid;
    if v_doctor is not null and not exists (select 1 from doctors
                                             where id = v_doctor and organization_id = p_organization_id) then
      raise exception 'الطبيب غير موجود في هذه المنشأة';
    end if;
  end if;

  if p_entry_id is null then
    insert into dental_chart_entries (
      organization_id, patient_id, branch_id, doctor_id, visit_date,
      tooth_numbers, tooth_type, main_complaint, diagnosis_text, diagnosis_icd10_id,
      procedure_done, anesthesia, complications, prophylactic_antibiotics,
      patient_family_education, next_visit_plan, note,
      is_xray, full_arch, upper_arch, lower_arch, ortho_upper, ortho_lower, orthodontics,
      created_by, updated_by)
    values (
      p_organization_id, p_patient_id, nullif(p_payload ->> 'branch_id', '')::uuid, v_doctor, v_date,
      v_teeth, v_type,
      nullif(btrim(p_payload ->> 'main_complaint'), ''),
      nullif(btrim(p_payload ->> 'diagnosis_text'), ''),
      v_icd,
      nullif(btrim(p_payload ->> 'procedure_done'), ''),
      nullif(btrim(p_payload ->> 'anesthesia'), ''),
      nullif(btrim(p_payload ->> 'complications'), ''),
      nullif(btrim(p_payload ->> 'prophylactic_antibiotics'), ''),
      nullif(btrim(p_payload ->> 'patient_family_education'), ''),
      nullif(btrim(p_payload ->> 'next_visit_plan'), ''),
      nullif(btrim(p_payload ->> 'note'), ''),
      coalesce((p_payload ->> 'is_xray')::boolean, false),
      coalesce((p_payload ->> 'full_arch')::boolean, false),
      coalesce((p_payload ->> 'upper_arch')::boolean, false),
      coalesce((p_payload ->> 'lower_arch')::boolean, false),
      coalesce((p_payload ->> 'ortho_upper')::boolean, false),
      coalesce((p_payload ->> 'ortho_lower')::boolean, false),
      coalesce((p_payload ->> 'orthodontics')::boolean, false),
      auth.uid(), auth.uid())
    returning id into v_id;

    insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
    values (p_organization_id, auth.uid(), 'medical_records', 'add', v_id, 'إجراء أسنان',
            concat_ws(' · ', nullif(array_to_string(v_teeth, ', '), ''), left(p_payload ->> 'procedure_done', 120)));
    return v_id;
  end if;

  select * into v_old from dental_chart_entries where id = p_entry_id for update;
  if v_old.id is null or v_old.organization_id is distinct from p_organization_id
     or v_old.patient_id is distinct from p_patient_id then
    raise exception 'الإجراء غير موجود لهذا المريض';
  end if;
  if v_old.visit_id is not null then
    raise exception 'هذا الإجراء جزءٌ من زيارة — يُعدَّل من شاشة الزيارة';
  end if;
  if v_old.is_cancelled then
    raise exception 'الإجراء ملغى — لا يُعدَّل';
  end if;

  update dental_chart_entries set
    doctor_id                = coalesce(v_doctor, v_old.doctor_id),
    visit_date               = v_date,
    tooth_numbers            = v_teeth,
    tooth_type               = v_type,
    main_complaint           = nullif(btrim(p_payload ->> 'main_complaint'), ''),
    diagnosis_text           = nullif(btrim(p_payload ->> 'diagnosis_text'), ''),
    diagnosis_icd10_id       = v_icd,
    procedure_done           = nullif(btrim(p_payload ->> 'procedure_done'), ''),
    anesthesia               = nullif(btrim(p_payload ->> 'anesthesia'), ''),
    complications            = nullif(btrim(p_payload ->> 'complications'), ''),
    prophylactic_antibiotics = nullif(btrim(p_payload ->> 'prophylactic_antibiotics'), ''),
    patient_family_education = nullif(btrim(p_payload ->> 'patient_family_education'), ''),
    next_visit_plan          = nullif(btrim(p_payload ->> 'next_visit_plan'), ''),
    note                     = nullif(btrim(p_payload ->> 'note'), ''),
    is_xray                  = coalesce((p_payload ->> 'is_xray')::boolean, false),
    full_arch                = coalesce((p_payload ->> 'full_arch')::boolean, false),
    upper_arch               = coalesce((p_payload ->> 'upper_arch')::boolean, false),
    lower_arch               = coalesce((p_payload ->> 'lower_arch')::boolean, false),
    ortho_upper              = coalesce((p_payload ->> 'ortho_upper')::boolean, false),
    ortho_lower              = coalesce((p_payload ->> 'ortho_lower')::boolean, false),
    orthodontics             = coalesce((p_payload ->> 'orthodontics')::boolean, false),
    -- ما وقّع عليه المريض تغيّر: التوقيع لا يبقى على نصٍّ لم يره
    patient_signature        = null,
    patient_signed_at        = null,
    patient_signed_by        = null,
    updated_by               = auth.uid(),
    updated_at               = now()
  where id = p_entry_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'medical_records', 'update', p_entry_id, 'إجراء أسنان',
          'عُدِّل الإجراء' || case when v_old.patient_signature is not null then ' — وسقط توقيع المريض السابق' else '' end);
  return p_entry_id;
end;
$$;
revoke all on function app_save_dental_procedure(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function app_save_dental_procedure(uuid, uuid, jsonb, uuid) to authenticated;

-- ── ٤) الإلغاء بسبب (لا حذف) ───────────────────────────────────────────────
create or replace function app_cancel_dental_procedure(p_entry_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row dental_chart_entries%rowtype;
begin
  select * into v_row from dental_chart_entries where id = p_entry_id for update;
  if v_row.id is null or v_row.organization_id is null then
    raise exception 'الإجراء غير موجود';
  end if;
  if not app_has_permission(v_row.organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بإلغاء الإجراءات الطبية (medical_records.write)';
  end if;
  if v_row.visit_id is not null then
    raise exception 'هذا الإجراء جزءٌ من زيارة — يُعدَّل من شاشة الزيارة';
  end if;
  if v_row.is_cancelled then
    return;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'اكتب سبب الإلغاء';
  end if;
  update dental_chart_entries
     set is_cancelled = true, cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = btrim(p_reason), updated_at = now(), updated_by = auth.uid()
   where id = p_entry_id;
  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details, reason)
  values (v_row.organization_id, auth.uid(), 'medical_records', 'update', p_entry_id, 'إجراء أسنان',
          'أُلغي الإجراء', btrim(p_reason));
end;
$$;
revoke all on function app_cancel_dental_procedure(uuid, text) from public, anon;
grant execute on function app_cancel_dental_procedure(uuid, text) to authenticated;

-- ── ٥) توقيع المريض على الإجراء ─────────────────────────────────────────────
create or replace function app_sign_dental_procedure(p_entry_id uuid, p_signature text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row dental_chart_entries%rowtype;
begin
  select * into v_row from dental_chart_entries where id = p_entry_id for update;
  if v_row.id is null or v_row.organization_id is null then
    raise exception 'الإجراء غير موجود';
  end if;
  if not app_has_permission(v_row.organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بأخذ توقيع المريض (medical_records.write)';
  end if;
  if v_row.is_cancelled then
    raise exception 'الإجراء ملغى';
  end if;
  if p_signature is not null then
    if p_signature not like 'data:image/png;base64,%' then
      raise exception 'صيغة التوقيع غير مدعومة';
    end if;
    if length(p_signature) > 400000 then
      raise exception 'صورة التوقيع أكبر من المسموح';
    end if;
  end if;
  update dental_chart_entries
     set patient_signature = p_signature,
         patient_signed_at = case when p_signature is null then null else now() end,
         patient_signed_by = case when p_signature is null then null else auth.uid() end
   where id = p_entry_id;
  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_row.organization_id, auth.uid(), 'medical_records', 'update', p_entry_id, 'إجراء أسنان',
          case when p_signature is null then 'مُسح توقيع المريض' else 'وقّع المريض على الإجراء' end);
end;
$$;
revoke all on function app_sign_dental_procedure(uuid, text) from public, anon;
grant execute on function app_sign_dental_procedure(uuid, text) to authenticated;

-- ── ٦) السجلّ الموحّد للمريض ───────────────────────────────────────────────
drop view if exists v_patient_dental_log;
create view v_patient_dental_log
with (security_invoker = on) as
select
  'zaincare'::text                                                   as source,
  d.id,
  coalesce(d.organization_id, v.organization_id)                     as organization_id,
  coalesce(d.patient_id, v.patient_id)                               as patient_id,
  coalesce(d.visit_date, (coalesce(v.visit_date, d.created_at) at time zone 'Asia/Riyadh')::date) as visit_date,
  d.created_at                                                       as recorded_at,
  coalesce(d.doctor_id, v.doctor_id)                                 as doctor_id,
  doc.name_ar                                                        as doctor_name,
  d.tooth_numbers                                                    as teeth,
  d.tooth_type,
  array_remove(array[
    case when d.full_arch    then 'full_arch'    end,
    case when d.upper_arch   then 'upper_arch'   end,
    case when d.lower_arch   then 'lower_arch'   end,
    case when d.is_xray      then 'xray'         end,
    case when d.ortho_upper  then 'ortho_upper'  end,
    case when d.ortho_lower  then 'ortho_lower'  end,
    case when d.orthodontics then 'orthodontics' end], null)          as targets,
  d.main_complaint,
  coalesce(d.diagnosis_text,
           case when icd.id is not null then icd.code || ' ' || coalesce(icd.name_ar, icd.name_en) end) as diagnosis,
  icd.code                                                           as icd10_code,
  d.diagnosis_icd10_id,
  d.procedure_done                                                   as procedure_text,
  d.anesthesia,
  d.complications,
  d.prophylactic_antibiotics                                         as antibiotics,
  d.patient_family_education                                         as education,
  coalesce(d.next_visit_plan, v.next_visit_plan)                     as next_visit,
  d.note,
  d.created_by,
  d.updated_at,
  d.updated_by,
  d.is_cancelled,
  d.cancel_reason,
  (d.patient_signature is not null)                                  as has_signature,
  d.patient_signed_at,
  d.visit_id,
  d.diagnosis_text                                                   as diagnosis_free_text
from dental_chart_entries d
left join patient_visits v on v.id = d.visit_id
left join doctors doc      on doc.id = coalesce(d.doctor_id, v.doctor_id)
left join icd10_codes icd  on icd.id = d.diagnosis_icd10_id
union all
select
  'plan',
  tp.id,
  tp.organization_id,
  tp.patient_id,
  (coalesce(tp.performed_at, tp.planned_at) at time zone 'Asia/Riyadh')::date,
  coalesce(tp.performed_at, tp.planned_at),
  tp.doctor_id,
  doc.name_ar,
  array[tp.tooth_number],
  tp.tooth_type,
  '{}'::text[],
  tp.chief_complaint,
  coalesce(tp.diagnosis_text,
           case when icd.id is not null then icd.code || ' ' || coalesce(icd.name_ar, icd.name_en) end),
  icd.code,
  tp.diagnosis_icd10_id,
  coalesce(i.name_ar, tp.procedure_kind),
  tp.anesthesia,
  tp.complications,
  tp.antibiotic_prophylaxis,
  tp.patient_education,
  case when tp.next_visit_date is not null then to_char(tp.next_visit_date, 'YYYY-MM-DD') end,
  tp.note,
  tp.performed_by,
  tp.updated_at,
  null::uuid,
  false,
  null::text,
  false,
  null::timestamptz,
  tp.visit_id,
  tp.diagnosis_text
from tooth_procedures tp
left join items i         on i.id = tp.item_id
left join doctors doc     on doc.id = tp.doctor_id
left join icd10_codes icd on icd.id = tp.diagnosis_icd10_id
where tp.status = 'completed'
union all
select
  'kizen',
  r.id,
  r.organization_id,
  r.patient_id,
  (r.recorded_at at time zone 'Asia/Riyadh')::date,
  r.recorded_at,
  null::uuid,
  r.doctor_name,
  coalesce(string_to_array(nullif(regexp_replace(coalesce(r.tooth, ''), '\s', '', 'g'), ''), ','), '{}'),
  case when coalesce(r.tooth, '') ~ '(^|[^0-9])[5-8][1-5]($|[^0-9])' then 'primary' else 'permanent' end,
  '{}'::text[],
  r.complaint,
  r.diagnosis,
  null::text,
  null::uuid,
  r.procedure_text,
  null::text, null::text, null::text, null::text, null::text,
  r.details,
  null::uuid,
  null::timestamptz,
  null::uuid,
  r.is_disabled,
  null::text,
  false,
  null::timestamptz,
  null::uuid,
  r.diagnosis
from legacy_patient_records r
where r.kind = 'dental_visit' and r.patient_id is not null;

comment on view v_patient_dental_log is
  'سجلّ إجراءات الأسنان للمريض (0211): السجلّ المستقلّ وصفوف الزيارات + إجراءات الخطّة المنفَّذة + زيارات Kizen القديمة للقراءة.';
grant select on v_patient_dental_log to authenticated;

commit;

-- ── النتيجة ──────────────────────────────────────────────────────────────────
select source as "المصدر", count(*) as "الإجراءات", count(distinct patient_id) as "المرضى"
  from v_patient_dental_log
 group by source
 order by 1;
