-- ============================================================================
-- 0096 — المرحلة 16: الباقات والاشتراكات الطبية
-- ============================================================================
--
-- **ما كان قائمًا وما ينقصه**
--
-- الجداول الأربعة (`packages`, `package_items`, `patient_packages`,
-- `patient_package_usages`) موجودة منذ 0016، وفيها مدّة صلاحية وعدد مرّات لكل
-- خدمة. لكن الباقة كانت **ورقةً لا عقدًا**:
--
--   • تُباع بإدراج صفٍّ مباشرةً بلا فاتورة — فيدخل المريض برصيدٍ لم يُدفع.
--   • الاستخدام يُخصم **يدويًّا** من شاشة الباقات؛ فمن نفّذ الخدمة في العيادة
--     لا يعرف أنها من باقة، فتُفوتَر مرّةً ثانية على المريض.
--   • لا تجميد ولا إلغاء ولا تجديد ولا استرداد.
--   • لا أهلية عمر ولا جنس ولا فرع ولا طبيب.
--
-- هذه الهجرة تجعلها عقدًا: تُباع بفاتورة، وتُخصم **عند تنفيذ الخدمة تلقائيًّا**،
-- فلا تُفوتَر مرّتين، وتُجمَّد وتُلغى وتُجدَّد ويُسترَدّ غيرُ المستخدَم منها وفق
-- سياسة مكتوبة.
--
-- **لا حذف**: الباقة الملغاة والاستخدام المُلغى يبقيان مسجَّلَين.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) تعريف الباقة: السعر والأهلية والنطاق والسياسة
-- ===========================================================================
alter table packages
  add column if not exists branch_id            uuid references branches(id),
  add column if not exists subscription_type    text not null default 'one_time',
  add column if not exists list_price           numeric(14,2),
  add column if not exists min_age_years        integer,
  add column if not exists max_age_years        integer,
  add column if not exists gender_restriction   text,
  add column if not exists allowed_doctor_ids   uuid[],
  add column if not exists allowed_specialty_value_id uuid references lookup_values(id),
  add column if not exists is_transferable      boolean not null default false,
  add column if not exists is_refundable        boolean not null default true,
  add column if not exists refund_policy        text,
  add column if not exists max_renewals         integer,
  add column if not exists description_ar       text,
  add column if not exists is_archived          boolean not null default false,
  add column if not exists archived_at          timestamptz,
  add column if not exists archived_by          uuid references auth.users(id),
  add column if not exists created_by           uuid references auth.users(id),
  add column if not exists updated_at           timestamptz not null default now(),
  add column if not exists updated_by           uuid references auth.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'packages_subscription_type_check') then
    alter table packages add constraint packages_subscription_type_check
      check (subscription_type in ('one_time','monthly','quarterly','annual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packages_gender_check') then
    alter table packages add constraint packages_gender_check
      check (gender_restriction is null or gender_restriction in ('male','female'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packages_age_range_check') then
    alter table packages add constraint packages_age_range_check
      check (min_age_years is null or max_age_years is null or min_age_years <= max_age_years);
  end if;
end $$;

comment on column packages.list_price is
  'مجموع أسعار الخدمات مفردةً. الفرق بينه وبين `price` هو وفر الباقة الذي يُعرض للمريض — يُحسب تلقائيًّا من البنود إن تُرك فارغًا.';
comment on column packages.branch_id is
  'فرع الباقة، أو NULL لباقة متاحة في كل الفروع.';
comment on column packages.is_transferable is
  'قابلية نقل الرصيد المتبقّي إلى مريض آخر. الافتراضي المنع: النقل الحرّ يجعل الباقة عملةً تُتداول.';

-- **حدّ الاستخدام لكل زيارة** على مستوى البند: باقة بعشرين جلسة لا تُستهلك
-- في يوم واحد.
alter table package_items
  add column if not exists organization_id       uuid references organizations(id),
  add column if not exists max_per_visit         numeric(10,2),
  add column if not exists min_days_between_uses integer,
  add column if not exists sort_order            integer not null default 0;

update package_items pi
   set organization_id = pk.organization_id
  from packages pk
 where pi.package_id = pk.id and pi.organization_id is null;

-- ===========================================================================
-- 2) اشتراك المريض: الفرع، والتجميد، والإلغاء، والتجديد، والاسترداد
-- ===========================================================================
alter table patient_packages
  add column if not exists branch_id        uuid references branches(id),
  add column if not exists price_paid       numeric(14,2),
  add column if not exists frozen_at        timestamptz,
  add column if not exists frozen_days      integer not null default 0,
  add column if not exists freeze_reason    text,
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references auth.users(id),
  add column if not exists cancel_reason    text,
  add column if not exists refunded_amount  numeric(14,2) not null default 0,
  add column if not exists refund_note_id   uuid references sales_invoices(id),
  add column if not exists renewed_from_id  uuid references patient_packages(id),
  add column if not exists renewal_count    integer not null default 0,
  add column if not exists transferred_from_patient_id uuid references patients(id),
  add column if not exists transferred_at   timestamptz,
  add column if not exists created_by       uuid references auth.users(id),
  add column if not exists updated_at       timestamptz not null default now(),
  add column if not exists updated_by       uuid references auth.users(id);

-- الحالة تتّسع: التجميد والإلغاء والاسترداد حالاتٌ لا شطبٌ للصف
do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'patient_packages'::regclass and conname like '%status%';
  if v_con is not null then
    execute format('alter table patient_packages drop constraint %I', v_con);
  end if;
  -- الترتيب مقصود: تُوسَّع القيم قبل تثبيت القيد، لا بعده
  alter table patient_packages add constraint patient_packages_status_check
    check (status in ('active','frozen','expired','consumed','cancelled','refunded'));
end $$;

create index if not exists idx_patient_packages_active
  on patient_packages (organization_id, patient_id, status)
  where status in ('active','frozen');

-- ربط الاستخدام بالخدمة المنفَّذة: بدونه لا يُعرف أيّ خدمةٍ خصمت الرصيد
alter table patient_package_usages
  add column if not exists organization_id  uuid references organizations(id),
  add column if not exists visit_service_id uuid references patient_visit_services(id),
  add column if not exists visit_id         uuid references patient_visits(id),
  add column if not exists is_reversed      boolean not null default false,
  add column if not exists reversed_at      timestamptz,
  add column if not exists reversed_by      uuid references auth.users(id),
  add column if not exists reversal_reason  text;

update patient_package_usages u
   set organization_id = pp.organization_id
  from patient_packages pp
 where u.patient_package_id = pp.id and u.organization_id is null;

-- استخدامٌ واحد لكل خدمة منفَّذة: الحارس ضدّ الخصم المزدوج عند إعادة
-- تشغيل المُحفِّز أو تعديل حالة الخدمة مرّتين.
create unique index if not exists uq_usage_per_visit_service
  on patient_package_usages (visit_service_id)
  where visit_service_id is not null and not is_reversed;

alter table patient_visit_services
  add column if not exists package_usage_id uuid references patient_package_usages(id);

comment on column patient_visit_services.package_usage_id is
  'استخدام الباقة الذي غطّى هذه الخدمة. وجودُه يعني أن الخدمة **مدفوعة سلفًا**، فتُفوتَر بصفرٍ لا بسعرها.';

-- ===========================================================================
-- 3) أهلية الشراء
-- ===========================================================================
create or replace function app_check_package_eligibility(
  p_package_id uuid,
  p_patient_id uuid,
  p_branch_id  uuid default null,
  p_doctor_id  uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pk     packages%rowtype;
  v_pat    patients%rowtype;
  v_age    integer;
  v_blocks text[] := '{}';
begin
  select * into v_pk from packages where id = p_package_id;
  if v_pk.id is null then raise exception 'الباقة غير موجودة'; end if;
  select * into v_pat from patients where id = p_patient_id;
  if v_pat.id is null then raise exception 'المريض غير موجود'; end if;

  if v_pk.organization_id <> v_pat.organization_id then
    raise exception 'الباقة والمريض في منشأتين مختلفتين';
  end if;

  if coalesce(v_pk.is_active, true) is not true or coalesce(v_pk.is_archived, false) then
    v_blocks := v_blocks || ('الباقة غير مفعّلة أو مؤرشفة')::text;
  end if;

  -- الفرع: باقة الفرع لا تُباع في فرع آخر
  if v_pk.branch_id is not null and p_branch_id is not null
     and v_pk.branch_id <> p_branch_id then
    v_blocks := v_blocks || ('الباقة غير متاحة في هذا الفرع')::text;
  end if;

  -- العمر يُحسب لحظة البيع؛ ومريضٌ بلا تاريخ ميلاد لا يُقاس عليه شرطُ عمر
  if v_pat.birth_date is not null then
    v_age := extract(year from age(v_pat.birth_date))::int;
    if v_pk.min_age_years is not null and v_age < v_pk.min_age_years then
      v_blocks := v_blocks || (format('العمر %s أقلّ من حدّ الباقة %s', v_age, v_pk.min_age_years))::text;
    end if;
    if v_pk.max_age_years is not null and v_age > v_pk.max_age_years then
      v_blocks := v_blocks || (format('العمر %s أكبر من حدّ الباقة %s', v_age, v_pk.max_age_years))::text;
    end if;
  elsif v_pk.min_age_years is not null or v_pk.max_age_years is not null then
    v_blocks := v_blocks || ('الباقة مقيَّدة بالعمر وتاريخ ميلاد المريض غير مسجَّل')::text;
  end if;

  if v_pk.gender_restriction is not null
     and coalesce(v_pat.gender, '') <> v_pk.gender_restriction then
    v_blocks := v_blocks || ('الباقة مخصَّصة لجنس آخر')::text;
  end if;

  if v_pk.allowed_doctor_ids is not null and array_length(v_pk.allowed_doctor_ids, 1) > 0
     and p_doctor_id is not null
     and not (p_doctor_id = any(v_pk.allowed_doctor_ids)) then
    v_blocks := v_blocks || ('الطبيب غير مشمول بالباقة')::text;
  end if;

  -- **التخصّص المسموح**: عمودٌ يَعِد بقيدٍ ولا يفرضه أسوأ من غيابه، لأن
  -- الموظّف يظنّ الباقة محميّة. يُفرض هنا كما يُفرض قيد الطبيب.
  if v_pk.allowed_specialty_value_id is not null and p_doctor_id is not null then
    if not exists (select 1 from doctors d
                    where d.id = p_doctor_id
                      and d.specialty_value_id = v_pk.allowed_specialty_value_id) then
      v_blocks := v_blocks || ('تخصّص الطبيب غير مشمول بالباقة')::text;
    end if;
  end if;

  return jsonb_build_object(
    'eligible', array_length(v_blocks, 1) is null,
    'blocks',   to_jsonb(v_blocks),
    'age',      v_age);
end $$;

-- ===========================================================================
-- 3.5) مصدر الضريبة يقبل بندًا بلا صنف
-- ===========================================================================
--
-- `app_compute_line_tax` (المرحلة 12) كان يرفض `p_item_id` فارغًا. لكن في
-- الفاتورة بنودٌ حقيقية بلا صنف: **الباقة** كوحدة، والبند اليدويّ المسموح
-- بصلاحية `billing.manual_line`. رفضُها هنا يدفع كل مسار منها إلى حساب
-- ضريبته بنفسه — وهو بالضبط ازدواج منطق الضريبة الذي وحّدته المرحلة 12.
--
-- البند بلا صنف **خاضع بنسبة المنشأة**: لا إعفاء بلا صنفٍ يحمل سببه، لأن
-- الإعفاء الصامت أخطر من الاحتساب الزائد.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_compute_line_tax';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'دالّة حساب ضريبة البند غير موجودة'; end if;
  if position('p_item_id is not null' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    E'  select * into v_item from items where id = p_item_id;\n'
    '  if v_item.id is null then raise exception ''الصنف غير موجود''; end if;',
    E'  if p_item_id is not null then\n'
    '    select * into v_item from items where id = p_item_id;\n'
    '    -- معرّفٌ لا يقابله صنف ما زال خطأً: الصمت هنا يُخفي بندًا فاسدًا\n'
    '    if v_item.id is null then raise exception ''الصنف غير موجود''; end if;\n'
    '  end if;');

  if v_new = v_src then
    raise exception 'تعذّر توسيع دالّة الضريبة لتقبل بندًا بلا صنف';
  end if;
  execute v_new;
end $$;

-- ===========================================================================
-- 4) البيع: باقةٌ لا تدخل رصيد المريض إلا بفاتورة
-- ===========================================================================
create or replace function app_sell_package(
  p_package_id uuid,
  p_patient_id uuid,
  p_branch_id  uuid default null,
  p_doctor_id  uuid default null,
  p_clinic_id  uuid default null,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pk       packages%rowtype;
  v_elig     jsonb;
  v_invoice  uuid;
  v_pp       uuid;
  v_branch   uuid;
  v_price    numeric;
  v_vat      record;
begin
  select * into v_pk from packages where id = p_package_id;
  if v_pk.id is null then raise exception 'الباقة غير موجودة'; end if;

  if not app_has_permission(v_pk.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح ببيع الباقات (billing.issue)';
  end if;

  v_branch := coalesce(p_branch_id, v_pk.branch_id,
                       (select id from branches
                         where organization_id = v_pk.organization_id
                         order by is_main desc nulls last, created_at limit 1));

  v_elig := app_check_package_eligibility(p_package_id, p_patient_id, v_branch, p_doctor_id);
  if (v_elig->>'eligible')::boolean is not true then
    raise exception 'المريض غير مؤهّل للباقة: %',
      array_to_string(array(select jsonb_array_elements_text(v_elig->'blocks')), '؛ ');
  end if;

  -- باقة سارية واحدة من نفس النوع: بيع ثانيةٍ قبل استهلاك الأولى يُنشئ
  -- رصيدين متوازيين لا يعرف الموظّف من أيّهما يخصم.
  if exists (select 1 from patient_packages
              where patient_id = p_patient_id and package_id = p_package_id
                and status in ('active','frozen')) then
    raise exception 'للمريض باقة سارية من هذا النوع — جدّدها أو استهلكها أولًا';
  end if;

  v_price := coalesce(v_pk.price, 0);

  -- الفاتورة أوّلًا، فالرصيد تابعٌ لها
  insert into sales_invoices (organization_id, branch_id, clinic_id, doctor_id,
                              patient_id, status, invoice_type, note, created_by)
  values (v_pk.organization_id, v_branch, p_clinic_id, p_doctor_id,
          p_patient_id, 'draft', 'sale',
          coalesce(p_note, format('باقة: %s', v_pk.name_ar)), auth.uid())
  returning id into v_invoice;

  -- الضريبة على الباقة كوحدة، لا على بنودها: البند المعفى داخل باقة خاضعة
  -- لا يجعل الباقة معفاة، والعكس. الحساب من مصدر المرحلة 12.
  select t.vat_category, t.vat_rate, t.vat_amount, t.exemption_reason, t.taxable_base
    into v_vat
    from app_compute_line_tax(v_pk.organization_id, null, p_patient_id,
                              v_price, 1, 0) t;

  -- **الاشتراك يُنشأ قبل بند الفاتورة** ليكون هو مصدر البند.
  --
  -- `uq_invoice_source_once` (المرحلة 11) يمنع تفويتر المصدر الواحد مرّتين.
  -- لو جعلنا المصدر `package_id` لَما بيعت الباقة إلا مرّةً واحدة في عمر
  -- المنشأة كلّها — والمصدر الصحيح هو **اشتراك هذا المريض**، فهو الحدث
  -- الذي لا يتكرّر.
  insert into patient_packages (organization_id, branch_id, patient_id, package_id,
                                sales_invoice_id, status, price_paid, created_by)
  values (v_pk.organization_id, v_branch, p_patient_id, p_package_id,
          v_invoice, 'active', v_price, auth.uid())
  returning id into v_pp;

  insert into sales_invoice_items (
    organization_id, invoice_id, branch_id, patient_id, item_id, description,
    line_type, price, qty, list_price,
    vat_category, vat_rate, vat_amount, taxable_base, exemption_reason,
    net_amount, patient_share, insurer_share,
    source_type, source_id, item_name_snapshot)
  values (
    v_pk.organization_id, v_invoice, v_branch, p_patient_id, null,
    format('باقة: %s', v_pk.name_ar),
    'normal', v_price, 1, coalesce(v_pk.list_price, v_price),
    v_vat.vat_category, v_vat.vat_rate, v_vat.vat_amount, v_vat.taxable_base,
    v_vat.exemption_reason,
    v_price + coalesce(v_vat.vat_amount, 0), v_price + coalesce(v_vat.vat_amount, 0), 0,
    'package', v_pp, format('باقة: %s', v_pk.name_ar));

  update sales_invoices
     set subtotal_amount = v_price,
         vat_amount      = coalesce(v_vat.vat_amount, 0),
         net_amount      = v_price + coalesce(v_vat.vat_amount, 0),
         patient_share_amount = v_price + coalesce(v_vat.vat_amount, 0)
   where id = v_invoice;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_pk.organization_id, auth.uid(), 'packages', 'add', v_pp, 'بيع باقة',
          format('بيعت باقة %s بفاتورة مسوّدة %s', v_pk.name_ar, v_invoice));

  return jsonb_build_object('patient_package_id', v_pp, 'invoice_id', v_invoice);
end $$;

-- ===========================================================================
-- 5) الخصم التلقائي عند تنفيذ الخدمة
-- ===========================================================================
--
-- **هذا هو قلب المرحلة.** الخصم اليدويّ من شاشة الباقات يعني أن من ينفّذ
-- الخدمة في العيادة لا يعرف أنها من باقة، فتُفوتَر على المريض مرّةً ثانية —
-- وهو خطأٌ يُكتشف بعد الدفع لا قبله.
create or replace function app_claim_package_coverage(
  p_patient_id  uuid,
  p_item_id     uuid,
  p_qty         numeric,
  p_visit_id    uuid default null,
  p_service_id  uuid default null,
  p_doctor_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row       record;
  v_usage     uuid;
  v_last_use  timestamptz;
begin
  if coalesce(p_qty, 0) <= 0 then return null; end if;

  -- **الأقرب انتهاءً أوّلًا** — نفس منطق FEFO في المخزون: الرصيد الذي
  -- ينتهي غدًا يُستهلك قبل الذي ينتهي بعد سنة، وإلا ضاع.
  for v_row in
    select pp.id            as patient_package_id,
           pp.organization_id,
           pp.expires_at,
           pi.id            as package_item_id,
           pi.quantity_included,
           pi.max_per_visit,
           pi.min_days_between_uses,
           coalesce((select sum(u.quantity_used) from patient_package_usages u
                      where u.patient_package_id = pp.id
                        and u.package_item_id = pi.id
                        and not u.is_reversed), 0) as used
      from patient_packages pp
      join packages pk on pk.id = pp.package_id
      join package_items pi on pi.package_id = pp.package_id
     where pp.patient_id = p_patient_id
       and pi.item_id = p_item_id
       and pp.status = 'active'                      -- المجمَّدة لا تُخصَم منها
       and (pp.expires_at is null or pp.expires_at > now())
       and (pk.allowed_doctor_ids is null
            or array_length(pk.allowed_doctor_ids, 1) is null
            or p_doctor_id is null
            or p_doctor_id = any(pk.allowed_doctor_ids))
       -- التخصّص يُفحص عند الخصم أيضًا لا عند البيع فقط: الباقة قد تُباع
       -- بلا طبيب محدَّد ثم تُستهلك عند طبيبٍ من تخصّص آخر.
       and (pk.allowed_specialty_value_id is null
            or p_doctor_id is null
            or exists (select 1 from doctors d
                        where d.id = p_doctor_id
                          and d.specialty_value_id = pk.allowed_specialty_value_id))
     order by pp.expires_at nulls last, pp.purchased_at
  loop
    if v_row.quantity_included - v_row.used < p_qty then
      continue;  -- رصيد هذه الباقة لا يكفي الكمّية كاملةً
    end if;

    if v_row.max_per_visit is not null and p_qty > v_row.max_per_visit then
      continue;  -- تتجاوز حدّ الزيارة الواحدة
    end if;

    if v_row.min_days_between_uses is not null then
      select max(u.used_at) into v_last_use
        from patient_package_usages u
       where u.patient_package_id = v_row.patient_package_id
         and u.package_item_id = v_row.package_item_id
         and not u.is_reversed;
      if v_last_use is not null
         and v_last_use > now() - make_interval(days => v_row.min_days_between_uses) then
        continue;  -- المدّة بين الاستخدامين لم تكتمل
      end if;
    end if;

    insert into patient_package_usages (organization_id, patient_package_id,
                                        package_item_id, quantity_used, used_by,
                                        visit_id, visit_service_id, note)
    values (v_row.organization_id, v_row.patient_package_id, v_row.package_item_id,
            p_qty, auth.uid(), p_visit_id, p_service_id, 'خصم تلقائي عند تنفيذ الخدمة')
    returning id into v_usage;

    -- الباقة المستهلَكة كاملةً تُغلق، فلا تظهر في قوائم الاختيار
    if not exists (
      select 1 from package_items pi2
       where pi2.package_id = (select package_id from patient_packages
                                where id = v_row.patient_package_id)
         and pi2.quantity_included >
             coalesce((select sum(u2.quantity_used) from patient_package_usages u2
                        where u2.patient_package_id = v_row.patient_package_id
                          and u2.package_item_id = pi2.id
                          and not u2.is_reversed), 0)
    ) then
      update patient_packages set status = 'consumed', updated_at = now()
       where id = v_row.patient_package_id;
    end if;

    return v_usage;
  end loop;

  return null;
end $$;

create or replace function app_auto_consume_package()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit patient_visits%rowtype;
  v_usage uuid;
begin
  -- الخصم عند **التنفيذ** لا عند الطلب: خدمةٌ طُلبت ولم تُنفَّذ لا تُنقص رصيدًا
  if new.status <> 'performed' then return new; end if;
  if new.package_usage_id is not null then return new; end if;
  if TG_OP = 'UPDATE' and old.status = 'performed' then return new; end if;

  select * into v_visit from patient_visits where id = new.visit_id;
  if v_visit.id is null then return new; end if;

  v_usage := app_claim_package_coverage(
    v_visit.patient_id, new.item_id, coalesce(new.qty, 1),
    new.visit_id, new.id, coalesce(new.performed_by, v_visit.doctor_id));

  if v_usage is not null then
    update patient_visit_services set package_usage_id = v_usage where id = new.id;
  end if;

  return new;
end $$;

drop trigger if exists trg_auto_consume_package on patient_visit_services;
create trigger trg_auto_consume_package
  after insert or update of status on patient_visit_services
  for each row execute function app_auto_consume_package();

-- ===========================================================================
-- 6) الفوترة تحترم التغطية: الخدمة المغطّاة تُعرض ولا تُحمَّل
-- ===========================================================================
--
-- تُعرض بصفرٍ ولا تُحذف من الفاتورة: المريض يرى ما تلقّاه، ويرى أنه مشمول
-- بباقته. الحذف كان سيجعل الفاتورة تكذب على المريض بالنقصان.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_invoice_from_visit';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'دالّة الفوترة من الزيارة غير موجودة'; end if;
  if position('package_usage_id' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    'select s.id, s.item_id, s.qty, s.unit_price,',
    'select s.id, s.item_id, s.qty,'
    || ' case when s.package_usage_id is not null then 0 else s.unit_price end as unit_price,'
    || ' s.package_usage_id,');

  if v_new = v_src then
    raise exception 'تعذّر ترقيع دالّة الفوترة — تغيّر نصّها';
  end if;

  -- السعر المحسوب من قائمة الأسعار يُلغى أيضًا للخدمة المغطّاة
  v_new := replace(v_new,
    'v_amount := coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) * coalesce(v_src.qty, 1);',
    'if v_src.package_usage_id is not null then'
    || ' v_amount := 0;'
    || ' else'
    || ' v_amount := coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) * coalesce(v_src.qty, 1);'
    || ' end if;');

  v_new := replace(v_new,
    E'      from app_compute_line_tax(v_visit.organization_id, v_src.item_id,\n'
    '                                v_visit.patient_id,\n'
    '                                coalesce(nullif(v_src.unit_price, 0), v_price.price, 0),\n'
    '                                coalesce(v_src.qty, 1), 0) t;',
    E'      from app_compute_line_tax(v_visit.organization_id, v_src.item_id,\n'
    '                                v_visit.patient_id,\n'
    '                                case when v_src.package_usage_id is not null then 0\n'
    '                                     else coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) end,\n'
    '                                coalesce(v_src.qty, 1), 0) t;');

  -- **سعر البند نفسه** لا مجموعه فقط.
  --
  -- `v_amount` يُصفَّر أعلاه، لكن عمود `price` في البند يُحسب من تعبيره
  -- الخاص: `coalesce(nullif(unit_price,0), v_price.price, 0)`. وبما أن
  -- `nullif(0,0)` تُعيد NULL، كان السعر يرتدّ إلى قائمة الأسعار فيظهر البند
  -- بـ 200 وصافيه صفر — رقمان متناقضان في السطر الواحد.
  v_new := replace(v_new,
    'coalesce(nullif(v_src.unit_price, 0), v_price.price, 0), coalesce(v_src.qty, 1),',
    'case when v_src.package_usage_id is not null then 0'
    || ' else coalesce(nullif(v_src.unit_price, 0), v_price.price, 0) end,'
    || ' coalesce(v_src.qty, 1),');

  -- الوصف يقول للمريض لماذا البند بصفر
  v_new := replace(v_new,
    'v_invoice, v_src.item_id, v_src.doctor_id, v_src.name_ar, ''normal'',',
    'v_invoice, v_src.item_id, v_src.doctor_id,'
    || ' case when v_src.package_usage_id is not null'
    || '      then v_src.name_ar || '' (مشمولة بالباقة)'' else v_src.name_ar end, ''normal'',');

  execute v_new;
end $$;

-- ===========================================================================
-- 7) التجميد والاستئناف والإلغاء والتجديد والنقل والاسترداد
-- ===========================================================================

-- التجميد **يوقف عدّاد الصلاحية**. بلا ذلك يخسر المريض أيّام تجميده،
-- فيصير التجميد عقوبةً لا خدمة.
create or replace function app_freeze_patient_package(
  p_patient_package_id uuid,
  p_reason             text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_pp patient_packages%rowtype;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  if not app_has_permission(v_pp.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بإدارة الاشتراكات (billing.issue)';
  end if;
  if v_pp.status <> 'active' then
    raise exception 'لا يُجمَّد اشتراك حالته %', v_pp.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب التجميد مطلوب'; end if;

  update patient_packages
     set status = 'frozen', frozen_at = now(), freeze_reason = p_reason,
         updated_at = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pp.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'تجميد اشتراك', 'جُمّد الاشتراك', p_reason);
end $$;

create or replace function app_resume_patient_package(p_patient_package_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp   patient_packages%rowtype;
  v_days integer;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  if not app_has_permission(v_pp.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بإدارة الاشتراكات (billing.issue)';
  end if;
  if v_pp.status <> 'frozen' then
    raise exception 'الاشتراك ليس مجمَّدًا (حالته %)', v_pp.status;
  end if;

  v_days := greatest(0, (extract(epoch from (now() - v_pp.frozen_at)) / 86400)::int);

  update patient_packages
     set status      = 'active',
         -- الصلاحية تُمدّ بعدد أيّام التجميد
         expires_at  = case when expires_at is not null
                            then expires_at + make_interval(days => v_days) end,
         frozen_days = frozen_days + v_days,
         frozen_at   = null,
         updated_at  = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_pp.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'استئناف اشتراك', format('استُؤنف بعد %s يومًا، ومُدّت الصلاحية بها', v_days));
end $$;

-- قيمة ما لم يُستخدَم — بالتناسب مع سعر الخدمات لا بالقسمة على العدد.
create or replace function app_package_unused_value(p_patient_package_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp        patient_packages%rowtype;
  v_total     numeric := 0;
  v_remaining numeric := 0;
  r           record;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id;
  if v_pp.id is null then return 0; end if;

  for r in
    select pi.quantity_included,
           coalesce(i.price, 0) as unit_price,
           coalesce((select sum(u.quantity_used) from patient_package_usages u
                      where u.patient_package_id = v_pp.id
                        and u.package_item_id = pi.id and not u.is_reversed), 0) as used
      from package_items pi
      join items i on i.id = pi.item_id
     where pi.package_id = v_pp.package_id
  loop
    v_total     := v_total + r.quantity_included * r.unit_price;
    v_remaining := v_remaining + greatest(0, r.quantity_included - r.used) * r.unit_price;
  end loop;

  if v_total <= 0 then return 0; end if;

  -- **بنسبة القيمة المتبقّية من قيمة الباقة كاملةً**، مطبَّقةً على ما دفعه
  -- المريض فعلًا. القسمة على عدد الحصص كانت تُعيد للمريض قيمة كشفٍ بسعر
  -- جلسة علاج طبيعي.
  return round(coalesce(v_pp.price_paid, 0) * (v_remaining / v_total), 2);
end $$;

create or replace function app_cancel_patient_package(
  p_patient_package_id uuid,
  p_reason             text,
  p_refund             boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp         patient_packages%rowtype;
  v_pk         packages%rowtype;
  v_unused     numeric := 0;
  v_note       uuid;
  v_line_id    uuid;
  v_line_price numeric;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  select * into v_pk from packages where id = v_pp.package_id;

  if not app_has_permission(v_pp.organization_id, 'billing.refund') then
    raise exception 'صلاحيتك لا تسمح بإلغاء الاشتراكات واستردادها (billing.refund)';
  end if;
  if v_pp.status in ('cancelled','refunded') then
    raise exception 'الاشتراك ملغى سلفًا';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب الإلغاء مطلوب'; end if;

  if p_refund then
    if coalesce(v_pk.is_refundable, true) is not true then
      raise exception 'الباقة غير قابلة للاسترداد وفق سياستها: %',
        coalesce(v_pk.refund_policy, 'لا استرداد');
    end if;
    v_unused := app_package_unused_value(p_patient_package_id);
    if v_unused > 0 and v_pp.sales_invoice_id is not null then
      -- **إشعار دائن لا حذف للفاتورة** — الفاتورة المُصدَرة لا تُمَسّ (المرحلة 12).
      --
      -- `app_create_credit_note` تُصدر إشعارًا عن **بنود الفاتورة نفسها**
      -- بكمّية جزئية، لا عن بندٍ حرّ. وبند الباقة كمّيته واحدة وقيمتها كاملة،
      -- فالاسترداد الجزئي يُعبَّر عنه بكسرٍ من الكمّية يساوي نسبة ما لم
      -- يُستخدَم. بهذا تمرّ الضريبة والترقيم والقيود في نفس المسار المُختبَر
      -- بدل مسارٍ ثانٍ خاصّ بالباقات.
      select li.id, li.price into v_line_id, v_line_price
        from sales_invoice_items li
       where li.invoice_id = v_pp.sales_invoice_id
         and li.source_type = 'package'
       order by li.created_at limit 1;

      if v_line_id is null or coalesce(v_line_price, 0) <= 0 then
        raise exception 'بند الباقة غير موجود في الفاتورة — تعذّر إصدار الإشعار الدائن';
      end if;

      v_note := app_create_credit_note(
        v_pp.sales_invoice_id,
        format('استرداد غير المستخدَم من باقة %s: %s', v_pk.name_ar, p_reason),
        jsonb_build_array(jsonb_build_object(
          'invoice_item_id', v_line_id,
          'qty', round(v_unused / v_line_price, 6))),
        'credit_note');
    end if;
  end if;

  update patient_packages
     set status          = case when p_refund and v_unused > 0 then 'refunded' else 'cancelled' end,
         cancelled_at    = now(), cancelled_by = auth.uid(), cancel_reason = p_reason,
         refunded_amount = v_unused,
         refund_note_id  = v_note,
         updated_at      = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pp.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'إلغاء اشتراك',
          format('أُلغي الاشتراك%s', case when v_unused > 0
                 then format(' واسترُدّ %s', v_unused) else '' end),
          p_reason);

  return jsonb_build_object('refunded_amount', v_unused, 'credit_note_id', v_note);
end $$;

create or replace function app_renew_patient_package(
  p_patient_package_id uuid,
  p_note               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp  patient_packages%rowtype;
  v_pk  packages%rowtype;
  v_res jsonb;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  select * into v_pk from packages where id = v_pp.package_id;

  if v_pk.max_renewals is not null and v_pp.renewal_count >= v_pk.max_renewals then
    raise exception 'بلغ الاشتراك حدّ التجديدات (%)', v_pk.max_renewals;
  end if;

  -- القديم يُغلق أوّلًا حتى لا يصطدم بحارس «باقة سارية واحدة»
  update patient_packages
     set status = case when status in ('active','frozen') then 'consumed' else status end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  v_res := app_sell_package(v_pp.package_id, v_pp.patient_id, v_pp.branch_id,
                            null, null, coalesce(p_note, 'تجديد اشتراك'));

  update patient_packages
     set renewed_from_id = p_patient_package_id,
         renewal_count   = v_pp.renewal_count + 1
   where id = (v_res->>'patient_package_id')::uuid;

  return v_res;
end $$;

create or replace function app_transfer_patient_package(
  p_patient_package_id uuid,
  p_to_patient_id      uuid,
  p_reason             text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pp patient_packages%rowtype;
  v_pk packages%rowtype;
begin
  select * into v_pp from patient_packages where id = p_patient_package_id for update;
  if v_pp.id is null then raise exception 'الاشتراك غير موجود'; end if;
  select * into v_pk from packages where id = v_pp.package_id;

  if not app_has_permission(v_pp.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بنقل الاشتراكات (billing.issue)';
  end if;
  if coalesce(v_pk.is_transferable, false) is not true then
    raise exception 'الباقة غير قابلة للنقل وفق تعريفها';
  end if;
  if v_pp.status not in ('active','frozen') then
    raise exception 'لا يُنقل اشتراك حالته %', v_pp.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب النقل مطلوب'; end if;

  -- المنقول إليه يجب أن يكون مؤهّلًا هو الآخر، وإلا صار النقل بابًا
  -- لتجاوز شروط العمر والجنس.
  if (app_check_package_eligibility(v_pp.package_id, p_to_patient_id,
                                    v_pp.branch_id, null)->>'eligible')::boolean is not true then
    raise exception 'المنقول إليه غير مؤهّل لهذه الباقة';
  end if;

  update patient_packages
     set transferred_from_patient_id = v_pp.patient_id,
         transferred_at = now(),
         patient_id     = p_to_patient_id,
         updated_at     = now(), updated_by = auth.uid()
   where id = p_patient_package_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_pp.organization_id, auth.uid(), 'packages', 'update', p_patient_package_id,
          'نقل اشتراك', 'نُقل الاشتراك إلى مريض آخر', p_reason);
end $$;

-- عكس الاستخدام حين تُلغى الخدمة بعد تنفيذها
create or replace function app_reverse_package_usage(
  p_usage_id uuid,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_u patient_package_usages%rowtype;
begin
  select * into v_u from patient_package_usages where id = p_usage_id for update;
  if v_u.id is null then raise exception 'الاستخدام غير موجود'; end if;
  if v_u.is_reversed then raise exception 'الاستخدام معكوس سلفًا'; end if;
  if not app_has_permission(v_u.organization_id, 'billing.issue') then
    raise exception 'صلاحيتك لا تسمح بعكس الاستخدام (billing.issue)';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب العكس مطلوب'; end if;

  -- **لا يُحذف السطر** — يُعلَّم معكوسًا ليبقى أثر الخصم والردّ معًا
  update patient_package_usages
     set is_reversed = true, reversed_at = now(), reversed_by = auth.uid(),
         reversal_reason = p_reason
   where id = p_usage_id;

  update patient_visit_services set package_usage_id = null
   where package_usage_id = p_usage_id;

  -- باقة أُغلقت لاستهلاكها تعود سارية بعد ردّ الرصيد
  update patient_packages set status = 'active', updated_at = now()
   where id = v_u.patient_package_id and status = 'consumed';

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_u.organization_id, auth.uid(), 'packages', 'update', p_usage_id,
          'عكس استخدام باقة', 'رُدّ الرصيد المخصوم', p_reason);
end $$;

-- ===========================================================================
-- 8) الحارس: الاستخدام المعكوس لا يُحتسب
-- ===========================================================================
--
-- `app_validate_package_usage` (0016) يفحص أربعة أشياء لا يجوز فقدان أيّها:
-- قفل الاشتراك ضدّ التزامن، وانتماء البند إلى باقة هذا الاشتراك، وموجبية
-- الكمّية، وملاءمة الخدمة السريرية للمريض. لذلك **يُرقَّع نصُّه** ولا يُعاد
-- كتابته: إعادة الكتابة كانت ستُسقط هذه الفحوص صامتةً.
--
-- الترقيع الوحيد المطلوب: استبعاد الاستخدام المعكوس من المجموع، وإلا بقي
-- الرصيد المردود محجوزًا فيُمنع المريض من خدمةٍ يملكها.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_validate_package_usage';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'حارس استخدام الباقة غير موجود'; end if;
  if position('is_reversed' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    E'   where package_item_id = new.package_item_id\n'
    '     and patient_package_id = new.patient_package_id;',
    E'   where package_item_id = new.package_item_id\n'
    '     and patient_package_id = new.patient_package_id\n'
    '     and not is_reversed;');

  if v_new = v_src then
    raise exception 'تعذّر ترقيع حارس الاستخدام — تغيّر نصّه';
  end if;

  -- المنشأة تُملأ من الاشتراك لتعمل RLS على سطر الاستخدام
  v_new := replace(v_new,
    E'  if new.used_by is null then',
    E'  new.organization_id := coalesce(new.organization_id, sub.organization_id);\n\n'
    '  if new.used_by is null then');

  execute v_new;
end $$;

-- ===========================================================================
-- 9) المناظير
-- ===========================================================================

-- سعر القائمة يُحسب من البنود إن لم يُحدَّد، ليظهر الوفر للمريض
drop view if exists v_package_catalog;
create view v_package_catalog
with (security_invoker = on) as
select
  pk.id, pk.organization_id, pk.branch_id, br.name as branch_name,
  pk.code, pk.name_ar, pk.name_en, pk.description_ar,
  pk.subscription_type, pk.validity_days,
  pk.price,
  coalesce(pk.list_price, agg.computed_list_price) as list_price,
  greatest(0, coalesce(pk.list_price, agg.computed_list_price) - pk.price) as savings,
  pk.min_age_years, pk.max_age_years, pk.gender_restriction,
  pk.allowed_doctor_ids, pk.allowed_specialty_value_id,
  pk.is_transferable, pk.is_refundable, pk.refund_policy, pk.max_renewals,
  pk.is_active, pk.is_archived,
  agg.item_count, agg.total_quantity,
  pk.created_at
from packages pk
left join branches br on br.id = pk.branch_id
left join lateral (
  select count(*)                         as item_count,
         sum(pi.quantity_included)        as total_quantity,
         sum(pi.quantity_included * coalesce(i.price, 0)) as computed_list_price
    from package_items pi
    join items i on i.id = pi.item_id
   where pi.package_id = pk.id
) agg on true;

comment on view v_package_catalog is
  'كتالوج الباقات بوفرها وأهليتها ونطاقها. سعر القائمة يُحسب من البنود إن لم يُحدَّد، فلا يظهر وفرٌ وهميّ.';

drop view if exists v_patient_subscriptions;
create view v_patient_subscriptions
with (security_invoker = on) as
select
  pp.id                as patient_package_id,
  pp.organization_id,
  pp.branch_id,
  br.name              as branch_name,
  pp.patient_id,
  p.name_ar            as patient_name,
  p.file_number,
  pp.package_id,
  pk.name_ar           as package_name,
  pk.subscription_type,
  pp.status,
  case
    when pp.status = 'active' and pp.expires_at is not null and pp.expires_at < now()
      then 'expired'
    else pp.status
  end                  as effective_status,
  pp.purchased_at,
  pp.expires_at,
  (pp.expires_at is not null and pp.expires_at < now()) as is_expired,
  case when pp.expires_at is not null
       then (pp.expires_at::date - current_date) end as days_remaining,
  pp.price_paid,
  pp.refunded_amount,
  pp.frozen_at,
  pp.frozen_days,
  pp.freeze_reason,
  pp.cancel_reason,
  pp.renewal_count,
  pp.renewed_from_id,
  pp.transferred_from_patient_id,
  pp.sales_invoice_id,
  inv.invoice_number,
  inv.status           as invoice_status,
  bal.total_included,
  bal.total_used,
  bal.total_remaining,
  app_package_unused_value(pp.id) as unused_value
from patient_packages pp
join patients p  on p.id  = pp.patient_id
join packages pk on pk.id = pp.package_id
left join branches br on br.id = pp.branch_id
left join sales_invoices inv on inv.id = pp.sales_invoice_id
left join lateral (
  select sum(pi.quantity_included) as total_included,
         sum(coalesce((select sum(u.quantity_used) from patient_package_usages u
                        where u.patient_package_id = pp.id
                          and u.package_item_id = pi.id and not u.is_reversed), 0))
           as total_used,
         sum(pi.quantity_included
             - coalesce((select sum(u.quantity_used) from patient_package_usages u
                          where u.patient_package_id = pp.id
                            and u.package_item_id = pi.id and not u.is_reversed), 0))
           as total_remaining
    from package_items pi where pi.package_id = pp.package_id
) bal on true;

comment on view v_patient_subscriptions is
  'اشتراكات المرضى برصيدها وصلاحيتها وحالتها الفعلية وقيمة غير المستخدَم. الحالة الفعلية تحسب الانتهاء، فلا يبدو منتهٍ ساريًا.';

-- `v_patient_package_balances` (0016) يجمع كل الاستخدامات بلا استثناء
-- المعكوس منها — فالرصيد المردود يبقى مخصومًا في الشاشة التي يقرأها
-- الموظّف، ويُمنع المريض من خدمةٍ يملكها. يُعاد بناؤه بنفس أعمدته.
drop view if exists v_patient_package_balances;
create view v_patient_package_balances
with (security_invoker = on) as
select
  pp.id                as patient_package_id,
  pp.organization_id,
  pp.patient_id,
  pt.name_ar           as patient_name,
  pp.package_id,
  pk.name_ar           as package_name,
  pp.status,
  pp.purchased_at,
  pp.expires_at,
  (pp.expires_at is not null and pp.expires_at < now()) as is_expired,
  case
    when pp.status <> 'active' then pp.status
    when pp.expires_at is not null and pp.expires_at < now() then 'expired'
    else 'active'
  end                  as effective_status,
  pi.id                as package_item_id,
  pi.item_id,
  it.name_ar           as item_name,
  pi.quantity_included,
  coalesce(sum(u.quantity_used), 0)                     as quantity_used,
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
       on u.package_item_id = pi.id
      and u.patient_package_id = pp.id
      and not u.is_reversed          -- ← المعكوس لا يُخصم
group by pp.id, pp.organization_id, pp.patient_id, pt.name_ar, pp.package_id,
         pk.name_ar, pp.status, pp.purchased_at, pp.expires_at,
         pi.id, pi.item_id, it.name_ar, pi.quantity_included,
         it.requires_fasting, it.requires_consent, it.preparation_ar;

comment on view v_patient_package_balances is
  'أرصدة باقات المريض بحبّة البند. الاستخدام المعكوس لا يُخصم — الرصيد المردود متاحٌ فعلًا.';

grant select on v_patient_package_balances to authenticated;

drop view if exists v_package_usage_log;
create view v_package_usage_log
with (security_invoker = on) as
select
  u.id                as usage_id,
  u.organization_id,
  pp.branch_id,
  u.used_at           as report_date,
  pp.patient_id,
  p.name_ar           as patient_name,
  pp.id               as patient_package_id,
  pk.name_ar          as package_name,
  pi.item_id,
  i.name_ar           as item_name,
  u.quantity_used,
  u.visit_id,
  u.visit_service_id,
  u.appointment_id,
  u.used_by,
  u.is_reversed,
  u.reversed_at,
  u.reversal_reason,
  u.note
from patient_package_usages u
join patient_packages pp on pp.id = u.patient_package_id
join packages pk on pk.id = pp.package_id
join package_items pi on pi.id = u.package_item_id
join items i on i.id = pi.item_id
join patients p on p.id = pp.patient_id;

comment on view v_package_usage_log is
  'سجل استخدام الباقات، شاملًا المعكوس منه — الخصم والردّ يظهران معًا لا يُمحى أحدهما.';

grant select on v_package_catalog, v_patient_subscriptions, v_package_usage_log
  to authenticated;

-- ===========================================================================
-- 10) رحلة المريض تعرض البيع والاستخدام والاسترداد
-- ===========================================================================
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_get_patient_timeline';
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
  v_src := replace(v_src, chr(13), '');
  if v_src is null then raise exception 'دالّة الخط الزمني غير موجودة'; end if;
  if position('package_sold' in v_src) > 0 then return; end if;

  -- تُضاف مجموعتان إلى تعبير `events` قبل قوسه الختامي. الترتيب الثابت
  -- لأعمدة المجموعة (١٣ عمودًا) مأخوذ من آخر مجموعة قائمة في الدالّة.
  v_new := replace(v_src,
    E'    from patient_documents pd\n'
    '    where pd.patient_id = p_patient_id\n'
    '  )',
    E'    from patient_documents pd\n'
    '    where pd.patient_id = p_patient_id\n'
    '\n'
    '    union all\n'
    '    -- بيع الباقة: يظهر في الرحلة بفاتورته لا كحدثٍ معلّق\n'
    '    select ''pkg:'' || pp.id::text,\n'
    '           ''package_sold'',\n'
    '           pp.purchased_at,\n'
    '           ''شراء باقة'',\n'
    '           pk.name_ar, pp.status, ''packages'',\n'
    '           pp.id, null::uuid, null::uuid, pp.sales_invoice_id, pp.created_by,\n'
    '           jsonb_build_object(''price_paid'', pp.price_paid,\n'
    '                              ''expires_at'', pp.expires_at)\n'
    '    from patient_packages pp\n'
    '    join packages pk on pk.id = pp.package_id\n'
    '    where pp.patient_id = p_patient_id\n'
    '\n'
    '    union all\n'
    '    -- الاستخدام والعكس كلاهما حدث: الرصيد المخصوم والمردود يظهران\n'
    '    select ''pkguse:'' || u.id::text,\n'
    '           ''package_used'',\n'
    '           u.used_at,\n'
    '           case when u.is_reversed then ''عكس استخدام باقة''\n'
    '                else ''استخدام من باقة'' end,\n'
    '           i.name_ar,\n'
    '           case when u.is_reversed then ''reversed'' else ''used'' end,\n'
    '           ''packages'',\n'
    '           u.id, u.appointment_id, u.visit_id, null::uuid, u.used_by,\n'
    '           jsonb_build_object(''quantity_used'', u.quantity_used,\n'
    '                              ''package_name'', pk2.name_ar,\n'
    '                              ''reversal_reason'', u.reversal_reason)\n'
    '    from patient_package_usages u\n'
    '    join patient_packages pp2 on pp2.id = u.patient_package_id\n'
    '    join packages pk2 on pk2.id = pp2.package_id\n'
    '    join package_items pi on pi.id = u.package_item_id\n'
    '    join items i on i.id = pi.item_id\n'
    '    where pp2.patient_id = p_patient_id\n'
    '  )');

  if v_new = v_src then
    raise exception 'تعذّر ترقيع الخط الزمني — تغيّر نصّه، وأحداث الباقات لن تظهر في رحلة المريض';
  end if;
  execute v_new;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_sell_package','app_claim_package_coverage',
                             'app_freeze_patient_package','app_resume_patient_package',
                             'app_cancel_patient_package','app_renew_patient_package',
                             'app_transfer_patient_package','app_reverse_package_usage',
                             'app_package_unused_value','app_check_package_eligibility']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة الباقات % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_auto_consume_package') then
    raise exception 'الخصم التلقائي عند تنفيذ الخدمة غير مركَّب';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_usage_per_visit_service') then
    raise exception 'لا حارس ضدّ الخصم المزدوج لنفس الخدمة';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'patient_visit_services'
                    and column_name = 'package_usage_id') then
    raise exception 'الخدمة بلا ربط باستخدام الباقة — ستُفوتَر مرّتين';
  end if;
  if position('package_usage_id' in
        (select pg_get_functiondef(p.oid) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'app_create_invoice_from_visit')) = 0 then
    raise exception 'الفوترة لا تحترم تغطية الباقة — الخدمة المغطّاة ستُحمَّل على المريض';
  end if;
end $$;
