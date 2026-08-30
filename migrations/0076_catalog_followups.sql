-- 0076_catalog_followups.sql
-- ثلاثة أشياء كشفها فحص «السطح الميت» بعد المراحل الثلاث.
--
-- الفحص يبحث عن دوال ومناظير وأعمدة أُنشئت ولا يستعملها أحد. وجد فيما بنيتُه
-- ثلاثة، وهذا الملف يعالج ما يخصّ القاعدة منها.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) تعريفان لاختيار كود المطالبة
--
-- `app_item_claim_code` (0073) ترتّب الأكواد: كود الشركة أولًا ثم العام،
-- والرئيسي قبل البديل. ثم كرّر مشغّل `app_fill_claim_item_code` الاستعلام
-- نفسه حرفيًا بدل استدعائها.
--
-- تعريفان لقاعدةٍ واحدة يفترقان عند أول تعديل يُطبَّق على أحدهما — والنتيجة
-- أن كود المطالبة الذي يعرضه النظام يختلف عمّا يكتبه في النموذج. يُستدعى
-- التعريف الواحد.
-- ---------------------------------------------------------------------------
create or replace function app_fill_claim_item_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_code    text;
  v_desc    text;
begin
  if new.item_id is null then
    return new;
  end if;

  -- شركة التأمين: نموذج ← عضوية المريض ← الوثيقة ← الشركة
  select pol.company_id into v_company
    from insurance_claim_forms f
    join patient_insurance_memberships m on m.id = f.membership_id
    join insurance_policies pol on pol.id = m.policy_id
   where f.id = new.form_id;

  select c.code, c.description into v_code, v_desc
    from app_item_claim_code(new.item_id, v_company) c;

  if (new.service_code is null or btrim(new.service_code) = '') and v_code is not null then
    new.service_code := v_code;
  end if;

  if new.description is null or btrim(new.description) = '' then
    select coalesce(v_desc, i.name_ar) into new.description from items i where i.id = new.item_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) `v_service_catalog` لم يكن يعرض كل ما تحتاجه الشاشة
--
-- الشاشة كانت تقرأ `items` مباشرةً لأن المنظور ينقصه الأرشفة والباركود
-- والفئة. فبقي المنظور معرَّفًا لا يقرؤه أحد — وهو العيب نفسه الذي يقيسه
-- الفحص. يُكمَّل المنظور لتقرأه الشاشة بدل تكرار الاستعلام.
-- ---------------------------------------------------------------------------
drop view if exists v_service_catalog;
create view v_service_catalog as
select
  i.id,
  i.organization_id,
  i.code,
  i.barcode,
  i.name_ar,
  i.name_en,
  i.description_ar,
  i.description_en,
  i.item_type,
  i.medical_service_type,
  i.category_value_id,
  cat.name_ar        as category_name,
  i.default_clinic_id,
  c.name             as clinic_name,
  i.duration_minutes,
  i.provider_role,
  i.requires_appointment,
  i.price,
  i.cost_price,
  i.default_discount_percent,
  i.is_vat_exempt,
  i.revenue_account_id,
  i.cogs_account_id,
  i.is_disabled,
  i.is_archived,
  i.archive_reason,
  i.archived_at,
  i.requires_fasting,
  i.fasting_hours,
  i.preparation_ar,
  i.min_age_years,
  i.max_age_years,
  i.gender_restriction,
  i.requires_consent,
  i.requires_preauthorization,
  i.requires_referral,
  coalesce(b.branch_ids, '{}')   as branch_ids,
  coalesce(r.resource_ids, '{}') as resource_ids,
  cc.code        as primary_claim_code,
  cc.code_system as primary_claim_code_system,
  i.created_at,
  i.updated_at
from items i
left join clinics c on c.id = i.default_clinic_id
left join lookup_values cat on cat.id = i.category_value_id
left join lateral (
  select array_agg(ib.branch_id) as branch_ids
    from item_branches ib where ib.item_id = i.id
) b on true
left join lateral (
  select array_agg(ir.resource_id) as resource_ids
    from item_resources ir where ir.item_id = i.id
) r on true
left join lateral (
  select x.code, x.code_system
    from item_claim_codes x
   where x.item_id = i.id and x.insurance_company_id is null and x.is_primary
   limit 1
) cc on true;

comment on view v_service_catalog is
  'الكتالوج الكامل بما فيه المؤرشف — رشّح بـ is_archived حسب الشاشة.';

alter view v_service_catalog set (security_invoker = on);
revoke all on v_service_catalog from anon;
grant select on v_service_catalog to authenticated;

-- ---------------------------------------------------------------------------
-- 3) `patient_documents.is_consent` و`signed_at`
--
-- أُضيفا في 0066 ولا يكتبهما أحد، بينما `items.requires_consent` (0073) يقول
-- إن الخدمة تحتاج إقرارًا موقَّعًا. الحلقة ناقصة: النظام يعرف أن الإقرار
-- مطلوب ولا يعرف هل وُقِّع.
--
-- هذا المنظور يُغلقها: لكل خدمة تتطلّب إقرارًا، هل للمريض مستند إقرار موقَّع؟
-- ---------------------------------------------------------------------------
create or replace view v_pending_consents as
select
  s.id                as visit_service_id,
  s.organization_id,
  v.patient_id,
  p.name_ar           as patient_name,
  p.file_number,
  s.item_id,
  i.name_ar           as item_name,
  i.consent_note_ar,
  v.visit_date,
  s.status,
  exists (
    select 1 from patient_documents d
     where d.patient_id = v.patient_id
       and d.is_consent
       and d.signed_at is not null
       and (d.expires_at is null or d.expires_at > now())
  ) as has_signed_consent
from patient_visit_services s
join patient_visits v on v.id = s.visit_id
join patients p on p.id = v.patient_id
join items i on i.id = s.item_id
where i.requires_consent
  and s.status in ('draft','ordered','performed');

alter view v_pending_consents set (security_invoker = on);
revoke all on v_pending_consents from anon;
grant select on v_pending_consents to authenticated;

comment on view v_pending_consents is
  'خدمات تتطلّب إقرارًا موقَّعًا، مع بيان هل وقّع المريض إقرارًا ساريًا.';

commit;
