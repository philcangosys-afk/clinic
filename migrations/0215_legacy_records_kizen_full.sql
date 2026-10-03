-- ============================================================================
-- 0215 — سجلّات المرضى من Kizen كاملةً (تصدير 03/10/2026): البنية
-- ----------------------------------------------------------------------------
-- يُكمل أرشيف `legacy_patient_records` (0194) لاستيراد `kizen_patient_records_1003`:
--   • أنواع جديدة: الوصفات، طلبيات المعمل، التقارير الطبية، عروض الأسعار
--     (إلى جانب الملاحظات والزيارات وزيارات الأسنان) — بلا جدولٍ جديد.
--   • مفتاحٌ ثابت لكلّ سجلّ (`kizen_key`) يجعل الاستيراد قابلًا للتكرار: التحديث
--     الأخير عند إيقاف Kizen يُشغَّل بالمفاتيح نفسها فلا يتكرّر شيء.
--   • زيارات الأسنان: الأسنان مصفوفة FDI (`teeth`) ونوعها (`dentition`)،
--     والتخدير والمضادّات والزيارة القادمة والمضاعفات في حقولٍ واضحة.
--   • `v_patient_dental_log` يقرأ هذه الحقول: الإطار الأحمر على المخطّط
--     والفلترة بالسنّ وتفاصيل الإجراء تشمل سجلّات Kizen.
-- البيانات نفسها لا تُكتب هنا (بيانات مرضى) — يكتبها ملفّ الاستيراد خارج git.
-- لا يمسّ الفواتير ولا ZATCA. معاملة واحدة، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';
lock table legacy_patient_records in access exclusive mode;

alter table legacy_patient_records
  add column if not exists kizen_key     text,
  add column if not exists teeth         smallint[],
  add column if not exists dentition     text,
  add column if not exists anesthesia    text,
  add column if not exists antibiotics   text,
  add column if not exists next_visit    text,
  add column if not exists complications text,
  add column if not exists payload       jsonb,
  add column if not exists imported_at   timestamptz;

-- الأنواع: القائمة القديمة + الجديدة (يُستبدل القيد أيًّا كان اسمه)
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.legacy_patient_records'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table legacy_patient_records drop constraint %I', r.conname);
  end loop;
end $$;
alter table legacy_patient_records add constraint legacy_patient_records_kind_check
  check (kind in ('note', 'visit', 'dental_visit', 'prescription', 'lab_order', 'medical_report', 'quote'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'legacy_patient_records_dentition_check') then
    alter table legacy_patient_records add constraint legacy_patient_records_dentition_check
      check (dentition is null or dentition in ('permanent', 'primary', 'none'));
  end if;
end $$;

create unique index if not exists uq_legacy_records_kizen_key
  on legacy_patient_records (organization_id, kizen_key) where kizen_key is not null;
create index if not exists idx_legacy_records_patient_kind
  on legacy_patient_records (patient_id, kind, recorded_at desc);

comment on column legacy_patient_records.kizen_key is
  'مفتاح السجلّ في تصدير Kizen (0215): DV- زيارة أسنان، CV- زيارة عيادة، RX- وصفة، LO- طلبية معمل، NT- ملاحظة، MR- تقرير طبي، QT- عرض سعر.';
comment on column legacy_patient_records.teeth is 'أسنان زيارة الأسنان بترقيم FDI (11–48 دائمة، 51–85 لبنية).';

-- ── السجلّ الموحّد لعيادة الأسنان (0211) — فرع Kizen يقرأ الحقول الجديدة ────
create or replace view v_patient_dental_log
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
  -- 0215: الأسنان بترقيم FDI من استيراد 03/10 (مصفوفة)، وإلّا نصّ الاستيراد الأوّل
  case when r.teeth is not null then r.teeth::text[]
       else coalesce(string_to_array(nullif(regexp_replace(coalesce(r.tooth, ''), '\s', '', 'g'), ''), ','), '{}') end,
  case when r.dentition = 'primary' then 'primary'
       when r.dentition is not null then 'permanent'
       when coalesce(r.tooth, '') ~ '(^|[^0-9])[5-8][1-5]($|[^0-9])' then 'primary' else 'permanent' end,
  '{}'::text[],
  r.complaint,
  r.diagnosis,
  null::text,
  null::uuid,
  r.procedure_text,
  r.anesthesia, r.complications, r.antibiotics, null::text, r.next_visit,
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

select kind as "النوع", count(*) as "السجلّات", count(kizen_key) as "بمفتاح 03/10", count(*) filter (where patient_id is null) as "بلا مريض"
  from legacy_patient_records group by kind order by 1;
