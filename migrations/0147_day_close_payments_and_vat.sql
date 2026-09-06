-- ---------------------------------------------------------------------------
-- 0147 — اليومية المالية، وطرق الدفع في الفاتورة، وضريبة الجنسية، وصيغة
--        الجوال والهوية
--
--   ١) الجوال والهوية: عشرة أرقام لا ناقصة ولا زائدة (للمنشآت السعودية).
--   ٢) الضريبة بالجنسية والهوية: الإعداد كان موجودًا في الشاشة ومقروءًا من
--      `app_resolve_vat_rate` — لكنّ **دالّة إنشاء الفاتورة لا تستدعيها
--      إطلاقًا**، فبقي إعفاء الجنسيات معطَّلًا فعليًّا مهما اختير في الشاشة.
--   ٣) طرق الدفع: تمارا كانت غائبة، وأسماء الشبكة والتحويل مكتوبة بالإنجليزية.
--   ٤) اليومية: فتح وإغلاق بقرار المستخدم لا بمنتصف الليل، وكل فاتورة وسند
--      يُنسَبان إلى اليومية المفتوحة وقت إنشائهما.
--   ٥) الدفع داخل معاملة الفاتورة: طريقة الدفع (أو أكثر من طريقة) تُسجَّل
--      سندَ قبضٍ حقيقيًّا مع إصدار الفاتورة، لا رقمًا في خانة «المدفوع» بلا
--      سند يقابله في الصندوق.
--
-- تُنفَّذ مرّتين بلا أثر مختلف (idempotent).
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) صيغة الجوال ورقم الهوية
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * الجوال والهوية عشرة أرقام في المنشآت السعودية.
 *
 * رقمٌ ناقص خانةً يمرّ اليوم ويظهر أثره بعد شهر: رسالة لا تصل، ومطالبة تأمين
 * تُرفض، وملفّ لا يُطابق مريضه. والفحص هنا لا في الواجهة وحدها لأن الكتابة
 * تأتي من الاستيراد ومن البوابة العامة كذلك.
 *
 * يُطبَّق على القيمة الجديدة فقط عند الإدراج أو عند **تغيّر** القيمة — فملفّ
 * قديم برقم ناقص يبقى قابلًا للتعديل (وإلّا تعذّر تصحيحه أصلًا)، ولا يُمنع
 * إلّا إدخال ناقصٍ جديد.
 */
create or replace function app_guard_patient_contact_format()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text;
  v_mobile  text := nullif(btrim(coalesce(new.mobile_number, '')), '');
  v_id      text := nullif(btrim(coalesce(new.id_number, '')), '');
begin
  v_country := coalesce((app_locale(new.organization_id)).country_code, 'SA');
  if v_country <> 'SA' then
    return new;
  end if;

  if v_mobile is not null
     and (tg_op = 'INSERT' or v_mobile is distinct from nullif(btrim(coalesce(old.mobile_number, '')), ''))
     and v_mobile !~ '^[0-9]{10}$' then
    raise exception 'رقم الجوال يجب أن يكون ١٠ أرقام بلا زيادة ولا نقص (المُدخَل: % خانة)',
      length(regexp_replace(v_mobile, '\D', '', 'g'));
  end if;

  if v_id is not null
     and (tg_op = 'INSERT' or v_id is distinct from nullif(btrim(coalesce(old.id_number, '')), ''))
     and v_id !~ '^[0-9]{10}$' then
    raise exception 'رقم الهوية يجب أن يكون ١٠ أرقام بلا زيادة ولا نقص (المُدخَل: % خانة)',
      length(regexp_replace(v_id, '\D', '', 'g'));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_patient_contact_format on patients;
create trigger trg_guard_patient_contact_format
  before insert or update of mobile_number, id_number on patients
  for each row execute function app_guard_patient_contact_format();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الإعفاء الضريبي بالجنسية والهوية
-- ═══════════════════════════════════════════════════════════════════════════

alter table organization_vat_settings
  add column if not exists vat_exempt_requires_id boolean not null default true;

comment on column organization_vat_settings.vat_exempt_requires_id is
  'الإعفاء بالجنسية يشترط وجود رقم هوية للمريض — الإعفاء يقوم على المواطن المُثبَتة هويته لا على خانة جنسية مكتوبة.';

/**
 * زرع الجنسية السعودية في قائمة الإعفاء للمنشآت السعودية التي لم تُعبِّئ
 * القائمة بعد.
 *
 * لا يُغيَّر شيء لمنشأة اختارت قائمتها بنفسها: الشرط أن تكون القائمة فارغة.
 * والقيمة قابلة للتبديل من شاشة إعدادات التشغيل متى شاءت المنشأة.
 */
do $$
declare
  v_nat uuid;
  v_org record;
  v_count integer := 0;
begin
  select lv.id into v_nat
    from lookup_values lv join lookup_categories lc on lc.id = lv.category_id
   where lc.key = 'nationalities' and lc.organization_id is null
     and btrim(lv.name_ar) = 'سعودي'
   order by lv.sort_order
   limit 1;

  if v_nat is null then
    raise notice '0147: قيمة الجنسية «سعودي» غير موجودة — تُنفَّذ 0146 أولًا';
    return;
  end if;

  -- المرور على المنشآت لا على صفوف الإعدادات: صفّ الإعدادات لا يُنشأ إلّا عند
  -- أوّل حفظ من الشاشة، فمنشأة لم تفتح الشاشة قطّ كانت ستبقى بلا إعفاء وهي
  -- الأحوج إليه. وأعمدة الصفّ الجديد كلّها بقيمها الافتراضية، فلا يتغيّر سلوك
  -- شيء غير الإعفاء.
  for v_org in
    select o.id as organization_id
      from organizations o
      left join organization_vat_settings s on s.organization_id = o.id
     where coalesce(array_length(s.vat_exempt_nationality_value_ids, 1), 0) = 0
       and coalesce((app_locale(o.id)).country_code, 'SA') = 'SA'
  loop
    insert into organization_vat_settings (organization_id, vat_exempt_nationality_value_ids)
    values (v_org.organization_id, array[v_nat])
    on conflict (organization_id) do update
      set vat_exempt_nationality_value_ids = array[v_nat];
    v_count := v_count + 1;
  end loop;
  raise notice '0147: أُعفيت الجنسية السعودية في % منشأة', v_count;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) طرق الدفع
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * أسماء عربية صريحة، وإضافة «تمارا».
 *
 * الاستقبال يختار الطريقة تحت ضغط الطابور، و«ATM-MADA» ليست ما يقوله المريض.
 * التسميات تُصحَّح ولا تُنشأ قيم جديدة مكرّرة، فالسندات القديمة تبقى مرتبطة
 * بنفس القيمة.
 */
do $$
declare
  v_cat uuid;
  v_added integer := 0;
begin
  select id into v_cat from lookup_categories
   where key = 'payment_methods' and organization_id is null order by id limit 1;
  if v_cat is null then
    insert into lookup_categories (organization_id, key, name_ar, name_en)
    values (null, 'payment_methods', 'طرق الدفع', 'Payment Methods') returning id into v_cat;
  end if;

  update lookup_values set name_ar = 'شبكة (مدى)'
   where category_id = v_cat and code = 'mada' and name_ar = 'ATM-MADA';
  update lookup_values set name_ar = 'شبكة (فيزا/ماستركارد)'
   where category_id = v_cat and name_ar = 'ATM-VISA/MasterCard';
  update lookup_values set name_ar = 'شبكة (أمريكان إكسبريس)'
   where category_id = v_cat and name_ar = 'American Express';
  update lookup_values set name_ar = 'شيك'
   where category_id = v_cat and name_ar = 'Cheque Payment';
  update lookup_values set name_ar = 'تابي (تقسيط)'
   where category_id = v_cat and name_ar = 'خدمة تابي';

  if not exists (select 1 from lookup_values
                  where category_id = v_cat and btrim(name_ar) = 'تمارا (تقسيط)') then
    insert into lookup_values (category_id, name_ar, name_en, code, sort_order, extra)
    values (v_cat, 'تمارا (تقسيط)', 'Tamara', 'bnpl', 65,
            '{"affects_drawer": false, "is_installment": true}'::jsonb);
    v_added := v_added + 1;
  end if;

  if not exists (select 1 from lookup_values
                  where category_id = v_cat and btrim(name_ar) = 'تحويل بنكي') then
    insert into lookup_values (category_id, name_ar, name_en, code, sort_order, extra)
    values (v_cat, 'تحويل بنكي', 'Bank Transfer', 'bank_transfer', 70,
            '{"affects_drawer": false, "is_bank": true}'::jsonb);
    v_added := v_added + 1;
  end if;

  -- النقد أوّل القائمة: هو الأشيع، وترتيبه يوفّر نقرة في كل فاتورة
  update lookup_values set sort_order = 10 where category_id = v_cat and code = 'cash';
  update lookup_values set sort_order = 20 where category_id = v_cat and code = 'mada';

  raise notice '0147: أُضيفت % طريقة دفع', v_added;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) اليومية المالية
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * اليومية: فترة عملٍ يفتحها ويغلقها الموظف، لا يومٌ تقويميّ.
 *
 * الإغلاق عند منتصف الليل لا يطابق الواقع: العيادة تُغلق بعد منتصف الليل
 * فتقع فواتير السهرة في «يوم» تالٍ لا أحد يعمل فيه، والجرد النقديّ لا يطابق
 * شيئًا. فاليومية تُفتح بأوّل فاتورة وتُغلق بقرار، وما بعد الإغلاق يقع في
 * يومية جديدة **ولو في التاريخ نفسه**.
 *
 * النطاق (منشأة، فرع): لكل فرع صندوقه وموظّفوه وإغلاقه.
 */
create table if not exists business_days (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id) on delete set null,
  day_number      bigint not null,
  business_date   date not null default current_date,
  opened_at       timestamptz not null default now(),
  opened_by       uuid references auth.users(id),
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id),
  note            text,
  created_at      timestamptz not null default now()
);

-- يومية مفتوحة واحدة لكل فرع: الفتح المتوازي يوزّع فواتير اليوم على يوميتَين
-- فلا يُطابق أيّهما الصندوق. القيمة البديلة للفرع الفارغ تجعل الفهرس يشمله.
create unique index if not exists business_days_one_open_per_branch
  on business_days (organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where closed_at is null;

create index if not exists idx_business_days_org_date
  on business_days (organization_id, business_date desc);

alter table business_days enable row level security;

drop policy if exists business_days_read on business_days;
create policy business_days_read on business_days
  for select using (app_is_member(organization_id));

-- الكتابة عبر الدوال وحدها: فتح يومية أو إغلاقها بكتابة مباشرة يلتفّ على
-- حارس «يومية مفتوحة واحدة» وعلى تسلسل الأرقام.
drop policy if exists business_days_no_direct_write on business_days;

alter table sales_invoices   add column if not exists business_day_id uuid references business_days(id);
alter table financial_vouchers add column if not exists business_day_id uuid references business_days(id);

create index if not exists idx_sales_invoices_business_day
  on sales_invoices (business_day_id) where business_day_id is not null;
create index if not exists idx_financial_vouchers_business_day
  on financial_vouchers (business_day_id) where business_day_id is not null;

/**
 * اليومية المفتوحة للفرع — تُفتح إن لم تكن مفتوحة.
 *
 * تُستدعى من داخل معاملة إنشاء الفاتورة والسند، فلا يحتاج المستخدم إلى «فتح
 * يومية» يدويًّا قبل أول فاتورة: أوّل عملية تفتحها.
 */
create or replace function app_ensure_business_day(p_organization_id uuid, p_branch_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id  uuid;
  v_num bigint;
begin
  select id into v_id
    from business_days
   where organization_id = p_organization_id
     and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and closed_at is null
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- قفل على مستوى المنشأة والفرع: فاتورتان في اللحظة نفسها كانتا ستفتحان
  -- يوميتَين، ويرفض الفهرس الثانية فتفشل فاتورة صحيحة.
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':day:' || coalesce(p_branch_id::text, '-'), 0));

  select id into v_id
    from business_days
   where organization_id = p_organization_id
     and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and closed_at is null
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(max(day_number), 0) + 1 into v_num
    from business_days where organization_id = p_organization_id;

  insert into business_days (organization_id, branch_id, day_number, opened_by)
  values (p_organization_id, p_branch_id, v_num, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function app_ensure_business_day(uuid, uuid) from public, anon;
grant execute on function app_ensure_business_day(uuid, uuid) to authenticated;

/**
 * إغلاق اليومية.
 *
 * لا يُغيَّر شيء في الفواتير المُنسَبة إليها: الإغلاق ختمٌ زمنيّ، وما يأتي
 * بعده يفتح يومية جديدة تلقائيًّا عند أوّل فاتورة.
 */
create or replace function app_close_business_day(
  p_organization_id uuid,
  p_branch_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not app_has_role(p_organization_id,
        array['owner','organization_admin','branch_manager','accountant']) then
    raise exception 'صلاحيتك لا تسمح بإغلاق اليومية';
  end if;

  select id into v_id
    from business_days
   where organization_id = p_organization_id
     and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and closed_at is null
   limit 1;

  if v_id is null then
    raise exception 'لا توجد يومية مفتوحة لهذا الفرع';
  end if;

  update business_days
     set closed_at = now(), closed_by = auth.uid(), note = nullif(btrim(p_note), '')
   where id = v_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (p_organization_id, auth.uid(), 'billing', 'update', v_id, 'إغلاق اليومية',
          coalesce(nullif(btrim(p_note), ''), 'أُغلقت اليومية'));

  return v_id;
end;
$$;
revoke all on function app_close_business_day(uuid, uuid, text) from public, anon;
grant execute on function app_close_business_day(uuid, uuid, text) to authenticated;

/**
 * ملخّص اليومية — ما يُقرأ عند الإغلاق وما يبقى في السجلّ بعده.
 *
 * الفاتورة الملغاة وعرض السعر مستثنيان من الإجماليات: أوّلهما لا مال فيه،
 * والثاني لم يُبَع بعد. والمحصَّل يأتي من السندات لا من خانة «المدفوع» في
 * الفاتورة، لأن السند هو ما يقابله نقدٌ في الصندوق.
 */
create or replace view v_business_day_summary as
select
  d.id                                    as business_day_id,
  d.organization_id,
  d.branch_id,
  d.day_number,
  d.business_date,
  d.opened_at,
  d.closed_at,
  d.closed_by,
  d.note,
  (d.closed_at is null)                   as is_open,
  coalesce(inv.invoices_count, 0)         as invoices_count,
  coalesce(inv.gross_amount, 0)           as gross_amount,
  coalesce(inv.discount_amount, 0)        as discount_amount,
  coalesce(inv.vat_amount, 0)             as vat_amount,
  coalesce(inv.exemption_amount, 0)       as exemption_amount,
  coalesce(inv.net_amount, 0)             as net_amount,
  coalesce(vch.collected_amount, 0)       as collected_amount,
  coalesce(vch.refunded_amount, 0)        as refunded_amount,
  coalesce(vch.collected_amount, 0) - coalesce(vch.refunded_amount, 0) as net_collected_amount,
  coalesce(inv.net_amount, 0) - (coalesce(vch.collected_amount, 0) - coalesce(vch.refunded_amount, 0))
                                          as outstanding_amount
from business_days d
left join lateral (
  select count(*)                                     as invoices_count,
         sum(i.subtotal_amount)                       as gross_amount,
         sum(i.discount_amount)                       as discount_amount,
         sum(i.vat_amount)                            as vat_amount,
         sum(i.exemption_amount)                      as exemption_amount,
         sum(i.net_amount)                            as net_amount
    from sales_invoices i
   where i.business_day_id = d.id
     and i.status <> 'void'
     and not coalesce(i.is_temporary, false)
) inv on true
left join lateral (
  select sum(case when v.voucher_type = 'receipt' then v.amount else 0 end) as collected_amount,
         sum(case when v.voucher_type <> 'receipt' then v.amount else 0 end) as refunded_amount
    from financial_vouchers v
   where v.business_day_id = d.id
     and not coalesce(v.is_void, false)
) vch on true;

alter view v_business_day_summary set (security_invoker = on);
grant select on v_business_day_summary to authenticated;

/** المحصَّل في اليومية موزَّعًا على طرق الدفع — هو ما يُجرَد به الصندوق. */
create or replace view v_business_day_collections as
select
  v.business_day_id,
  v.organization_id,
  coalesce(lv.name_ar, 'غير محدَّدة')                         as method_name,
  coalesce((lv.extra ->> 'affects_drawer')::boolean, false)   as affects_drawer,
  count(*)                                                    as vouchers_count,
  sum(case when v.voucher_type = 'receipt' then v.amount else -v.amount end) as amount
from financial_vouchers v
left join lookup_values lv on lv.id = v.payment_method_value_id
where v.business_day_id is not null
  and not coalesce(v.is_void, false)
group by v.business_day_id, v.organization_id, lv.name_ar, lv.extra;

alter view v_business_day_collections set (security_invoker = on);
grant select on v_business_day_collections to authenticated;

/** فواتير اليومية — القائمة التي تُراجَع قبل الإغلاق. */
create or replace view v_business_day_invoices as
select
  i.business_day_id,
  i.organization_id,
  i.id                  as invoice_id,
  i.invoice_number,
  i.created_at,
  i.status,
  i.is_temporary,
  i.invoice_type,
  i.net_amount,
  i.paid_amount,
  i.remaining_amount,
  p.name_ar             as patient_name,
  p.file_number,
  i.external_customer_name,
  d.name_ar             as doctor_name
from sales_invoices i
left join patients p on p.id = i.patient_id
left join doctors  d on d.id = i.doctor_id
where i.business_day_id is not null;

alter view v_business_day_invoices set (security_invoker = on);
grant select on v_business_day_invoices to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) إنشاء الفاتورة: الإعفاء بالجنسية، والدفعات، واليومية
--
-- الدالّة تُسقَط ثم تُنشأ بتوقيعها الجديد: إضافة معامل تُنشئ حِملًا زائدًا
-- (overload) فيبقى التوقيع القديم قائمًا وتستدعيه الواجهة بلا أن يعمل الجديد.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[]);
drop function if exists app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[], jsonb);

CREATE OR REPLACE FUNCTION public.app_create_sales_invoice(p_organization_id uuid, p_items jsonb, p_patient_id uuid DEFAULT NULL::uuid, p_external_customer_name text DEFAULT NULL::text, p_appointment_id uuid DEFAULT NULL::uuid, p_visit_id uuid DEFAULT NULL::uuid, p_doctor_id uuid DEFAULT NULL::uuid, p_clinic_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_invoice_type text DEFAULT 'sale'::text, p_original_invoice_id uuid DEFAULT NULL::uuid, p_is_insurance boolean DEFAULT false, p_insurance jsonb DEFAULT '{}'::jsonb, p_paid_amount numeric DEFAULT 0, p_is_temporary boolean DEFAULT false, p_is_b2b boolean DEFAULT false, p_id_number text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_lab_order_ids uuid[] DEFAULT NULL::uuid[], p_radiology_order_ids uuid[] DEFAULT NULL::uuid[], p_prescription_ids uuid[] DEFAULT NULL::uuid[], p_payments jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_invoice_id   uuid;
  v_vat_rate     numeric;
  v_vat_enabled  boolean;
  v_subtotal     numeric(14,2) := 0;
  v_discount     numeric(14,2) := 0;
  v_vat          numeric(14,2) := 0;
  v_exemption    numeric(14,2) := 0;
  v_net          numeric(14,2) := 0;
  v_paid         numeric(14,2);
  v_status       text;
  v_copay        numeric;
  v_max          numeric;
  v_ins_share    numeric(14,2) := 0;
  v_pat_share    numeric(14,2) := 0;
  v_count        integer;
  v_expected     integer;
  v_stamped      integer;
  v_settings     organization_vat_settings%rowtype;
  v_pat_nat      uuid;
  v_pat_id_num   text;
  v_patient_exempt boolean := false;
  v_branch       uuid;
  v_day_id       uuid;
  v_pay          jsonb;
  v_pay_amount   numeric;
begin
  -- (أ) الهوية والعضوية والدور -----------------------------------------------
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not app_has_role(p_organization_id,
        array['owner','organization_admin','branch_manager','accountant','receptionist']) then
    raise exception 'صلاحيتك لا تسمح بإصدار الفواتير';
  end if;

  if p_invoice_type not in ('sale','return') then
    raise exception 'نوع فاتورة غير معروف: %', p_invoice_type;
  end if;
  if p_patient_id is null and coalesce(btrim(p_external_customer_name),'') = '' then
    raise exception 'اختر مريضًا أو أدخل اسم عميل خارجي';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'أضف بندًا واحدًا على الأقل';
  end if;

  -- (ب) عزل المنشآت ----------------------------------------------------------
  if p_patient_id is not null and not exists (
       select 1 from patients where id = p_patient_id and organization_id = p_organization_id) then
    raise exception 'المريض المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if p_doctor_id is not null and not exists (
       select 1 from doctors where id = p_doctor_id and organization_id = p_organization_id) then
    raise exception 'الطبيب المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if p_clinic_id is not null and not exists (
       select 1 from clinics where id = p_clinic_id and organization_id = p_organization_id) then
    raise exception 'العيادة المحدَّدة لا تنتمي لهذه المنشأة';
  end if;
  if p_appointment_id is not null and not exists (
       select 1 from appointments where id = p_appointment_id and organization_id = p_organization_id) then
    raise exception 'الموعد المحدَّد لا ينتمي لهذه المنشأة';
  end if;
  if p_visit_id is not null and not exists (
       select 1 from patient_visits where id = p_visit_id and organization_id = p_organization_id) then
    raise exception 'الزيارة المحدَّدة لا تنتمي لهذه المنشأة';
  end if;

  select count(*) into v_count
    from jsonb_array_elements(p_items) e
   where nullif(e ->> 'item_id','') is not null
     and not exists (select 1 from items i
                      where i.id = (e ->> 'item_id')::uuid
                        and i.organization_id = p_organization_id);
  if v_count > 0 then
    raise exception '% من الأصناف لا تنتمي لهذه المنشأة', v_count;
  end if;

  select count(*) into v_count
    from jsonb_array_elements(p_items) e
   where nullif(e ->> 'visit_service_id','') is not null
     and not exists (
       select 1 from patient_visit_services s
        where s.id = (e ->> 'visit_service_id')::uuid
          and s.organization_id = p_organization_id
          and (p_visit_id is null or s.visit_id = p_visit_id));
  if v_count > 0 then
    raise exception '% من الخدمات لا تخصّ هذه المنشأة أو هذه الزيارة', v_count;
  end if;

  -- الطلبات المُمرَّرة: من هذه المنشأة، ومن الزيارة نفسها إن حُدِّدت. بدون هذا
  -- أمكن تمرير معرّف طلب من زيارة مريض آخر فيُختَم بفاتورة لا تخصّه.
  if p_lab_order_ids is not null and array_length(p_lab_order_ids, 1) > 0 then
    select count(*) into v_count
      from unnest(p_lab_order_ids) x(id)
     where not exists (
       select 1 from lab_orders o
        where o.id = x.id
          and o.organization_id = p_organization_id
          and (p_visit_id is null or o.visit_id = p_visit_id));
    if v_count > 0 then
      raise exception '% من طلبات المختبر لا تخصّ هذه المنشأة أو هذه الزيارة', v_count;
    end if;
  end if;
  if p_radiology_order_ids is not null and array_length(p_radiology_order_ids, 1) > 0 then
    select count(*) into v_count
      from unnest(p_radiology_order_ids) x(id)
     where not exists (
       select 1 from radiology_orders o
        where o.id = x.id
          and o.organization_id = p_organization_id
          and (p_visit_id is null or o.visit_id = p_visit_id));
    if v_count > 0 then
      raise exception '% من طلبات الأشعة لا تخصّ هذه المنشأة أو هذه الزيارة', v_count;
    end if;
  end if;
  if p_prescription_ids is not null and array_length(p_prescription_ids, 1) > 0 then
    select count(*) into v_count
      from unnest(p_prescription_ids) x(id)
     where not exists (
       select 1 from prescriptions pr
        where pr.id = x.id
          and pr.organization_id = p_organization_id
          and (p_visit_id is null or pr.visit_id = p_visit_id));
    if v_count > 0 then
      raise exception '% من الوصفات لا تخصّ هذه المنشأة أو هذه الزيارة', v_count;
    end if;
  end if;

  -- (ج) نسبة الضريبة والإعفاء — من القاعدة لا من العميل ---------------------
  --
  -- الإعفاء بالجنسية كان **معطَّلًا فعليًّا**: الإعداد يُقرأ في
  -- `app_resolve_vat_rate` وهذه الدالّة لا تستدعيها، فبقيت كل فاتورة تُحمَّل
  -- الضريبة مهما اختير في شاشة الإعدادات.
  --
  -- والإعفاء يشترط الهوية لا الجنسية وحدها (`vat_exempt_requires_id`): هو
  -- إعفاء مواطنٍ مُثبَتة هويته، وخانة جنسية مكتوبة بلا هوية ليست إثباتًا.
  select o.default_vat_rate into v_vat_rate from organizations o where o.id = p_organization_id;
  select * into v_settings from organization_vat_settings s where s.organization_id = p_organization_id;
  v_vat_enabled := coalesce(v_settings.sales_vat_enabled, true);
  v_vat_rate := coalesce(v_vat_rate, 0);
  if not v_vat_enabled then
    v_vat_rate := 0;
  end if;

  if p_patient_id is not null then
    select p.nationality_value_id, nullif(btrim(coalesce(p.id_number, '')), '')
      into v_pat_nat, v_pat_id_num
      from patients p where p.id = p_patient_id;

    -- منع الفاتورة بلا جنسية/هوية — إعدادٌ كان يُحفظ ولا يقرؤه شيء
    if coalesce(v_settings.block_invoice_without_nationality_or_id, false)
       and (v_pat_nat is null or v_pat_id_num is null) then
      raise exception 'الفاتورة تتطلّب جنسية ورقم هوية في ملفّ المريض — أكملهما في الملفّ ثم أعد الإصدار';
    end if;

    if v_pat_nat is not null
       and v_settings.vat_exempt_nationality_value_ids is not null
       and v_pat_nat = any (v_settings.vat_exempt_nationality_value_ids)
       and not coalesce(v_settings.vat_exemption_disabled_for_customer_types, false)
       and (not coalesce(v_settings.vat_exempt_requires_id, true) or v_pat_id_num is not null)
    then
      v_patient_exempt := true;
    end if;
  end if;

  -- (د) رأس الفاتورة بمبالغ صفرية، ثم تُحسب من البنود المُدرَجة فعلًا -------
  insert into sales_invoices (
    organization_id, invoice_type, original_invoice_id,
    patient_id, external_customer_name, appointment_id, visit_id,
    doctor_id, clinic_id, warehouse_id,
    is_temporary, is_b2b, id_number, note, created_by,
    is_insurance_invoice,
    insurance_company_name, insurance_policy_number, insurance_class_number,
    insurance_membership_number, insurance_copay_percent, insurance_max_amount,
    insurance_approval_number,
    subtotal_amount, discount_amount, vat_amount, exemption_amount, net_amount, paid_amount
  ) values (
    p_organization_id, p_invoice_type, p_original_invoice_id,
    p_patient_id, nullif(btrim(p_external_customer_name),''), p_appointment_id, p_visit_id,
    p_doctor_id, p_clinic_id, p_warehouse_id,
    coalesce(p_is_temporary,false), coalesce(p_is_b2b,false),
    nullif(btrim(p_id_number),''), nullif(btrim(p_note),''), auth.uid(),
    coalesce(p_is_insurance,false),
    nullif(btrim(p_insurance ->> 'company_name'),''),
    nullif(btrim(p_insurance ->> 'policy_number'),''),
    nullif(btrim(p_insurance ->> 'class_number'),''),
    nullif(btrim(p_insurance ->> 'membership_number'),''),
    nullif(p_insurance ->> 'copay_percent','')::numeric,
    nullif(p_insurance ->> 'max_amount','')::numeric,
    nullif(btrim(p_insurance ->> 'approval_number'),''),
    0, 0, 0, 0, 0, 0
  ) returning id into v_invoice_id;

  -- (هـ) البنود ---------------------------------------------------------------
  insert into sales_invoice_items (
    invoice_id, item_id, description, qty, price,
    discount_percent, discount_amount, vat_rate, vat_amount, exemption_amount,
    net_amount, doctor_id, agreement_item_id, line_type, source_barcode,
    visit_service_id
  )
  select
    v_invoice_id,
    nullif(e ->> 'item_id','')::uuid,
    coalesce(nullif(btrim(e ->> 'description'),''), i.name_ar, 'بند'),
    q.qty,
    q.price,
    q.disc_pct,
    q.line_discount,
    case when q.exempt then 0 else v_vat_rate end,
    q.line_vat,
    case when q.exempt then q.taxable else 0 end,
    q.taxable + q.line_vat,
    nullif(e ->> 'doctor_id','')::uuid,
    nullif(e ->> 'agreement_item_id','')::uuid,
    case
      when nullif(btrim(e ->> 'line_type'),'') in ('normal','follow_up','agreement')
        then btrim(e ->> 'line_type')
      when nullif(e ->> 'agreement_item_id','') is not null then 'agreement'
      else 'normal'
    end,
    nullif(btrim(e ->> 'source_barcode'),''),
    nullif(e ->> 'visit_service_id','')::uuid
  from jsonb_array_elements(p_items) e
  left join items i on i.id = nullif(e ->> 'item_id','')::uuid
  cross join lateral (
    select
      gq.qty, gq.price, gq.disc_pct, gq.exempt,
      round(gq.qty * gq.price, 2)                                   as line_subtotal,
      round(gq.qty * gq.price * gq.disc_pct / 100.0, 2)             as line_discount,
      round(gq.qty * gq.price, 2)
        - round(gq.qty * gq.price * gq.disc_pct / 100.0, 2)         as taxable,
      case when gq.exempt then 0
           else round((round(gq.qty * gq.price, 2)
                       - round(gq.qty * gq.price * gq.disc_pct / 100.0, 2))
                      * v_vat_rate / 100.0, 2) end                  as line_vat
    from (
      select
        greatest(coalesce(nullif(e ->> 'qty','')::numeric, 1), 0)          as qty,
        coalesce(nullif(e ->> 'price','')::numeric, i.price, 0)            as price,
        least(greatest(coalesce(nullif(e ->> 'discount_percent','')::numeric, 0), 0), 100) as disc_pct,
        -- إعفاء المريض يشمل كل بنود فاتورته، وإعفاء الصنف يبقى على حاله
        (v_patient_exempt
         or coalesce(nullif(e ->> 'is_vat_exempt','')::boolean, i.is_vat_exempt, false)) as exempt
    ) gq
  ) q;

  -- (و) الإجماليات من الصفوف المُدرَجة --------------------------------------
  select
    coalesce(sum(round(qty * price, 2)), 0),
    coalesce(sum(discount_amount), 0),
    coalesce(sum(vat_amount), 0),
    coalesce(sum(exemption_amount), 0),
    coalesce(sum(net_amount), 0)
  into v_subtotal, v_discount, v_vat, v_exemption, v_net
  from sales_invoice_items where invoice_id = v_invoice_id;

  -- (ز) حصّتا التأمين والمريض ------------------------------------------------
  if coalesce(p_is_insurance, false) then
    v_copay := coalesce(nullif(p_insurance ->> 'copay_percent','')::numeric, 0);
    v_copay := least(greatest(v_copay, 0), 100);
    v_max   := nullif(p_insurance ->> 'max_amount','')::numeric;

    v_pat_share := round(v_net * v_copay / 100.0, 2);
    v_ins_share := v_net - v_pat_share;

    if v_max is not null and v_ins_share > v_max then
      v_ins_share := v_max;
      v_pat_share := v_net - v_ins_share;
    end if;
  else
    v_pat_share := v_net;
    v_ins_share := 0;
  end if;

  -- (ح) المدفوع والحالة ------------------------------------------------------
  v_paid := greatest(coalesce(p_paid_amount, 0), 0);
  v_paid := least(v_paid, v_pat_share);

  v_status := case
    when p_is_temporary then 'unpaid'
    when v_paid >= v_net then 'paid'
    when v_paid > 0 then 'partial'
    else 'unpaid' end;

  -- اليومية المفتوحة للفرع — تُفتح إن لم تكن مفتوحة. الفرع يأتي من المُحفِّز
  -- الذي ملأه عند الإدراج، فيُقرأ من الصف لا يُخمَّن.
  select branch_id into v_branch from sales_invoices where id = v_invoice_id;
  v_day_id := app_ensure_business_day(p_organization_id, v_branch);

  update sales_invoices
     set business_day_id        = v_day_id,
         subtotal_amount        = v_subtotal,
         discount_amount        = v_discount,
         vat_amount             = v_vat,
         exemption_amount       = v_exemption,
         net_amount             = v_net,
         insurance_share_amount = v_ins_share,
         patient_share_amount   = v_pat_share,
         paid_amount            = v_paid,
         status                 = v_status,
         issued_at              = coalesce(issued_at, now()),
         issued_by              = coalesce(issued_by, auth.uid())
   where id = v_invoice_id;

  -- (ح٢) الدفعات — سندات قبض حقيقية داخل معاملة الفاتورة --------------------
  --
  -- خانة «المدفوع» وحدها كانت تكتب رقمًا في الفاتورة بلا سندٍ يقابله، فيظهر
  -- المال محصَّلًا في الفاتورة وغائبًا عن الصندوق وعن جرد اليومية. والتحصيل
  -- يمرّ بـ`app_receive_invoice_payment` نفسها التي تستعملها شاشة التحصيل:
  -- تفرض سقف المتبقّي، وتشترط مناوبة صندوق مفتوحة للنقد، وتكتب سند القبض
  -- والتخصيص معًا — ونسخُ منطقها هنا كان سيُنتج مسارَي تحصيل يتباعدان.
  --
  -- الدفع لا يقع على عرض سعر (لم يُبَع بعد) ولا على مرتجع (يُردّ لا يُقبض).
  if p_payments is not null and jsonb_typeof(p_payments) = 'array'
     and jsonb_array_length(p_payments) > 0
     and not coalesce(p_is_temporary, false)
     and p_invoice_type = 'sale'
  then
    for v_pay in select * from jsonb_array_elements(p_payments) loop
      v_pay_amount := round(coalesce(nullif(v_pay ->> 'amount','')::numeric, 0), 2);
      -- سطر بمبلغ صفر ليس خطأً: الواجهة تعرض صفَّي دفع ويُملأ أحدهما فقط
      if v_pay_amount > 0 then
        perform app_receive_invoice_payment(
          v_invoice_id,
          v_pay_amount,
          nullif(v_pay ->> 'payment_method_value_id','')::uuid,
          nullif(v_pay ->> 'cash_register_id','')::uuid,
          nullif(btrim(v_pay ->> 'reference'), ''),
          nullif(btrim(v_pay ->> 'note'), ''));
      end if;
    end loop;
  end if;

  -- (ط) ختم الطلبات بالفاتورة -------------------------------------------------
  --
  -- شرط `sales_invoice_id is null` هو حارس التزامن: لو فُوتِر الطلب في فاتورة
  -- أخرى بين لحظة العرض ولحظة الحفظ، لم يطابق التحديث شيئًا — فيختلف العدد
  -- وتُلغى المعاملة كلها. الاعتماد على الفحص المسبق وحده كان سيسمح بفوترة
  -- الطلب مرتين لمحاسبَيْن فتحا الشاشة معًا.
  --
  -- ولا خَتْم في فاتورة **مرتجعة**: المرتجع لا يُفوتِر الطلب بل يعكس فاتورة
  -- سابقة، وختمه به كان سيجعل الطلب مربوطًا بمرتجع لا بفاتورته الأصلية.
  if p_invoice_type = 'sale' then
    if p_lab_order_ids is not null and array_length(p_lab_order_ids, 1) > 0 then
      v_expected := array_length(p_lab_order_ids, 1);
      update lab_orders
         set sales_invoice_id = v_invoice_id
       where id = any (p_lab_order_ids)
         and organization_id = p_organization_id
         and sales_invoice_id is null;
      get diagnostics v_stamped = row_count;
      if v_stamped <> v_expected then
        raise exception 'أحد طلبات المختبر فُوتِر في فاتورة أخرى — حدِّث الصفحة لترى غير المفوتر فقط';
      end if;
    end if;

    if p_radiology_order_ids is not null and array_length(p_radiology_order_ids, 1) > 0 then
      v_expected := array_length(p_radiology_order_ids, 1);
      update radiology_orders
         set sales_invoice_id = v_invoice_id
       where id = any (p_radiology_order_ids)
         and organization_id = p_organization_id
         and sales_invoice_id is null;
      get diagnostics v_stamped = row_count;
      if v_stamped <> v_expected then
        raise exception 'أحد طلبات الأشعة فُوتِر في فاتورة أخرى — حدِّث الصفحة لترى غير المفوتر فقط';
      end if;
    end if;

    if p_prescription_ids is not null and array_length(p_prescription_ids, 1) > 0 then
      v_expected := array_length(p_prescription_ids, 1);
      update prescriptions
         set is_billed = true
       where id = any (p_prescription_ids)
         and organization_id = p_organization_id
         and is_billed = false;
      get diagnostics v_stamped = row_count;
      if v_stamped <> v_expected then
        raise exception 'إحدى الوصفات فُوتِرت في فاتورة أخرى — حدِّث الصفحة لترى غير المفوتر فقط';
      end if;
    end if;
  end if;

  return v_invoice_id;

exception
  when unique_violation then
    if sqlerrm like '%uq_invoice_item_visit_service%' then
      raise exception 'إحدى الخدمات المحدَّدة مفوترة في فاتورة سابقة — حدِّث الصفحة لترى الخدمات غير المفوترة فقط';
    end if;
    raise;
end;
$function$;

revoke all on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[], jsonb)
  from public, anon;
grant execute on function app_create_sales_invoice(uuid, jsonb, uuid, text, uuid, uuid, uuid, uuid,
  uuid, text, uuid, boolean, jsonb, numeric, boolean, boolean, text, text, uuid[], uuid[], uuid[], jsonb)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) سند القبض يُنسب إلى اليومية المفتوحة وقت التحصيل
--
-- لا إلى يومية الفاتورة: دفعةٌ تُحصَّل اليوم على فاتورة أمس مالٌ دخل صندوق
-- اليوم، وجردُ اليومية يجب أن يراه.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_stamp_voucher_business_day()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.business_day_id is null then
    new.business_day_id := app_ensure_business_day(new.organization_id, new.branch_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_voucher_business_day on financial_vouchers;
create trigger trg_stamp_voucher_business_day
  before insert on financial_vouchers
  for each row execute function app_stamp_voucher_business_day();

-- ---------------------------------------------------------------------------
-- إعادة تحميل ذاكرة المخطّط في PostgREST — **سطرٌ لا يجوز نسيانه**.
--
-- هذه الترقية أسقطت `app_create_sales_invoice` وأعادت إنشاءها بتوقيع جديد
-- (معامل `p_payments`). وPostgREST يحتفظ بتواقيع الدوال في ذاكرته ولا يعيد
-- قراءتها إلّا بإشعار: فيبقى يعرف التوقيع القديم، وحين يرسل المتصفّح
-- `p_payments` لا يجد دالّة تطابق الطلب فيردّ بـ400 (PGRST202) — والفاتورة
-- لا تُحفظ من الواجهة أبدًا بينما تنجح من محرّر SQL.
--
-- وقد وقع هذا فعلًا: نجحت الفاتورة في القاعدة وفشلت في الشاشة، حتى أُرسل
-- هذا الإشعار.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
