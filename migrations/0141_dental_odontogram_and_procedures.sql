-- ============================================================================
-- 0141 — مخطّط الأسنان: إجراءٌ لكل سنّ، وحالةٌ لكل سنّ
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   `dental_chart_entries` (الموجود) صفٌّ **واحد لكل زيارة** فيه:
--     • `tooth_numbers` — مصفوفة أرقام أسنان،
--     • `procedure_done` — **نصّ حرّ واحد** لكل تلك الأسنان معًا.
--
--   فلو خُلع 16 وحُشي 26 في زيارة واحدة، كُتب «خلع وحشوة» في خانة واحدة
--   لسنّين مختلفين. والنتيجة أن النظام لا يستطيع الإجابة عن أبسط سؤال في
--   عيادة أسنان: **ما الذي جرى لهذا السنّ بالذات؟** ولا عن الثاني: **ما حال
--   فم هذا المريض الآن؟**
--
--   وثلاثة آثار تتبع ذلك:
--     1) لا مخطّط أسنان حقيقي — `DentalChart.tsx` يختار أرقام أسنان فقط،
--        بلا حالة ولا لون ولا تاريخ.
--     2) لا ربط بين الإجراء وخدمته المسعّرة، فالفوترة تُدخَل يدويًّا مرّة
--        ثانية، وتفترق عمّا سُجّل سريريًّا.
--     3) لا خطة علاج على مستوى السنّ: «تقويم» تُكتب نصًّا، ولا يُعرف أيّ
--        الأسنان بقيت.
--
-- ما يفعله هذا الملف:
--   • `patient_tooth_status` — حال كل سنّ الآن (المخطّط).
--   • `tooth_procedures` — إجراءٌ لكل سنّ: مخطَّط، ثم منفَّذ، بتاريخه وطبيبه.
--   • `items.dental_procedure_kind` — الخدمة تقول أيّ إجراءٍ هي، فتُحدَّث
--     حال السنّ تلقائيًّا عند التنفيذ.
--   • ربط التنفيذ بـ`patient_visit_services` (الفوترة) وبـ
--     `treatment_agreement_items` (الخطة المالية) — **بلا جدول خطةٍ جديد**:
--     `treatment_agreements` القائم هو خطة العلاج المالية، ولا يُبنى له نظير.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.**
-- ============================================================================

do $zc_pre$
begin
  if to_regclass('public.dental_chart_entries') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0141: `dental_chart_entries` غير موجود.';
  end if;
  if to_regclass('public.patient_visit_services') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0141: `patient_visit_services` غير موجود.';
  end if;
  if to_regprocedure('public.app_has_permission(uuid,text)') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0141: `app_has_permission` غير موجودة.';
  end if;
end
$zc_pre$;

-- ===========================================================================
-- 1) المفردات المغلقة
-- ===========================================================================
-- ترقيم FDI: الدائمة 11–18، 21–28، 31–38، 41–48. اللبنية 51–55، 61–65،
-- 71–75، 81–85. رقمٌ خارجها ليس سنًّا، وقبولُه يعني مخطَّطًا لا يُقرأ.
create or replace function app_is_valid_tooth(p_tooth text, p_type text default 'permanent')
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_tooth is null then false
    when p_type = 'primary' then
      p_tooth ~ '^[5-8][1-5]$'
    else
      p_tooth ~ '^[1-4][1-8]$'
  end;
$$;

-- أسطح السنّ: إنسي، وحشي، إطباقي/قاطع، دهليزي، لساني/حنكي، عنقي.
create or replace function app_tooth_surface_keys()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array['mesial','distal','occlusal','buccal','lingual','cervical'];
$$;

-- حالات السنّ. قائمة مغلقة: حالةٌ لا لون لها في المخطّط لا معنى لتخزينها.
create or replace function app_tooth_condition_keys()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array['sound','caries','filled','crown','bridge','implant',
               'root_canal','missing','extracted','impacted','veneer',
               'orthodontic','under_treatment'];
$$;

-- أنواع إجراءات الأسنان. تُوسم بها الخدمة في الكتالوج مرّة، فتُعرف بعدها
-- في كل مكان.
create or replace function app_dental_procedure_kinds()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array['examination','cleaning','filling','extraction','root_canal',
               'crown','bridge','implant','veneer','whitening','orthodontic',
               'periodontal','surgery','xray','other'];
$$;

-- حال السنّ بعد الإجراء. الخريطة في مكانٍ واحد: لو تكرّرت في الواجهة
-- افترقت النسختان أوّل تعديل، فصار المخطّط يقول غير ما جرى.
create or replace function app_tooth_condition_after(p_kind text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'filling'      then 'filled'
    when 'extraction'   then 'extracted'
    when 'root_canal'   then 'root_canal'
    when 'crown'        then 'crown'
    when 'bridge'       then 'bridge'
    when 'implant'      then 'implant'
    when 'veneer'       then 'veneer'
    when 'orthodontic'  then 'orthodontic'
    -- التنظيف والتبييض والفحص والأشعة لا تُغيّر حال السنّ، فلا تُكتب حالة
    -- جديدة لمجرّد أن شيئًا جرى.
    else null
  end;
$$;

-- ===========================================================================
-- 2) الخدمة تقول أيّ إجراءٍ هي
-- ===========================================================================
alter table items
  add column if not exists dental_procedure_kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_dental_kind_check') then
    alter table items add constraint items_dental_kind_check
      check (dental_procedure_kind is null
             or dental_procedure_kind = any(app_dental_procedure_kinds()));
  end if;
end $$;

comment on column items.dental_procedure_kind is
  'نوع إجراء الأسنان الذي تمثّله هذه الخدمة. يُملأ مرّة في الكتالوج، فتُحدَّث حال السنّ تلقائيًّا عند تنفيذها.';

-- استنتاج نوع الإجراء من اسم الخدمة — قاعدة واحدة في مكان واحد.
--
-- **ولماذا مُحفِّز لا تعبئة مرّة واحدة؟** التعبئة مرّة واحدة تسم الخدمات
-- القائمة اليوم وتترك كل خدمة تُضاف غدًا بلا نوع. وخدمةٌ بلا نوع تعني أن
-- الطبيب ينفّذ خلعًا فلا تتغيّر حال السنّ في المخطّط — عطلٌ صامت يظهر بعد
-- أشهر حين يُكتشف أن المخطّط لا يطابق الملف. فالقاعدة تُطبَّق عند كل كتابة.
--
-- ولا تُلغي اختيار المستخدم: إن وُسمت الخدمة صراحةً بقي وسمُه.
create or replace function app_derive_dental_kind(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_name is null                    then null
    when p_name ~ 'خلع'                     then 'extraction'
    when p_name ~ 'حشو'                     then 'filling'
    when p_name ~ 'عصب|لبّ'                  then 'root_canal'
    when p_name ~ 'تلبيس|تاج'                then 'crown'
    when p_name ~ 'جسر'                     then 'bridge'
    when p_name ~ 'زراعة|زرع'                then 'implant'
    when p_name ~ 'قشور|فينير'               then 'veneer'
    when p_name ~ 'تبييض'                    then 'whitening'
    when p_name ~ 'تقويم'                    then 'orthodontic'
    when p_name ~ 'تنظيف|تقليح'              then 'cleaning'
    when p_name ~ 'لثة'                      then 'periodontal'
    else null
  end;
$$;

create or replace function app_fill_dental_kind()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.dental_procedure_kind is null then
    new.dental_procedure_kind := app_derive_dental_kind(new.name_ar);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_dental_kind on items;
create trigger trg_fill_dental_kind
  before insert or update of name_ar, dental_procedure_kind on items
  for each row execute function app_fill_dental_kind();

-- والخدمات القائمة تأخذه الآن.
update items
   set dental_procedure_kind = app_derive_dental_kind(name_ar)
 where dental_procedure_kind is null;

-- ===========================================================================
-- 3) حال كل سنّ الآن — المخطّط
-- ===========================================================================
create table if not exists patient_tooth_status (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  tooth_number    text not null,
  tooth_type      text not null default 'permanent'
                    check (tooth_type in ('permanent','primary')),
  condition       text not null default 'sound',
  surfaces        text[] not null default '{}',
  note            text,
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on table patient_tooth_status is
  'حال كل سنّ الآن. صفٌّ واحد لكل سنّ لكل مريض — المخطّط يقرأ منه، وتاريخُ ما جرى في tooth_procedures.';

create unique index if not exists uq_tooth_status_per_patient
  on patient_tooth_status (patient_id, tooth_number);
create index if not exists idx_tooth_status_org
  on patient_tooth_status (organization_id, patient_id);

alter table patient_tooth_status enable row level security;

-- ===========================================================================
-- 4) إجراءٌ لكل سنّ — ما جرى ومتى وبمَن
-- ===========================================================================
create table if not exists tooth_procedures (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  branch_id           uuid references branches(id),
  patient_id          uuid not null references patients(id),
  visit_id            uuid references patient_visits(id),
  doctor_id           uuid references doctors(id),
  tooth_number        text not null,
  tooth_type          text not null default 'permanent'
                        check (tooth_type in ('permanent','primary')),
  surfaces            text[] not null default '{}',
  -- الخدمة المسعّرة التي تمثّل هذا الإجراء. منها يُعرف نوعه وسعره.
  item_id             uuid references items(id),
  procedure_kind      text,
  status              text not null default 'planned'
                        check (status in ('planned','in_progress','completed','cancelled')),
  -- ربط الخطة بالمال: بند اتفاقية العلاج القائم، لا جدول خطة جديد.
  agreement_item_id   uuid references treatment_agreement_items(id),
  -- ربط التنفيذ بالفوترة: بند خدمة الزيارة.
  visit_service_id    uuid references patient_visit_services(id),
  diagnosis_icd10_id  uuid,
  note                text,
  planned_at          timestamptz not null default now(),
  planned_by          uuid references auth.users(id),
  performed_at        timestamptz,
  performed_by        uuid references auth.users(id),
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table tooth_procedures is
  'إجراء على سنّ بعينه: مخطَّط ثم منفَّذ. يحلّ محلّ procedure_done النصّي الذي كان يصف كل أسنان الزيارة بجملة واحدة.';

create index if not exists idx_tooth_proc_patient
  on tooth_procedures (patient_id, tooth_number, planned_at desc);
create index if not exists idx_tooth_proc_open
  on tooth_procedures (organization_id, status, planned_at);
create index if not exists idx_tooth_proc_visit
  on tooth_procedures (visit_id);

alter table tooth_procedures enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'patient_tooth_status'
                    and policyname = 'patient_tooth_status_members') then
    create policy patient_tooth_status_members on patient_tooth_status
      for all using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies
                  where tablename = 'tooth_procedures'
                    and policyname = 'tooth_procedures_members') then
    create policy tooth_procedures_members on tooth_procedures
      for all using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;
end $$;

-- حارس الأرقام والأسطح والحالات: القيمة الفاسدة تُرفض عند بابها لا بعد أن
-- تملأ المخطّط.
--
-- حارسان لا واحد: plpgsql يحلّ حقول `new` عند التنفيذ لا عند القراءة، فدالّة
-- واحدة تذكر `new.condition` و`new.procedure_kind` معًا تنهار على الجدول
-- الذي ينقصه أحدهما — حتى لو كان السطر داخل `if tg_table_name = …`.
create or replace function app_check_tooth_shape(
  p_tooth text, p_type text, p_surfaces text[]
)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare v_bad text;
begin
  if not app_is_valid_tooth(p_tooth, p_type) then
    raise exception 'رقم سنّ غير صالح (%) لنوع %', p_tooth, p_type;
  end if;
  select s into v_bad from unnest(coalesce(p_surfaces, '{}')) s
   where s <> all(app_tooth_surface_keys()) limit 1;
  if v_bad is not null then
    raise exception 'سطح سنّ غير معروف: %', v_bad;
  end if;
end;
$$;

create or replace function app_guard_tooth_status_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_check_tooth_shape(new.tooth_number, new.tooth_type, new.surfaces);
  if new.condition <> all(app_tooth_condition_keys()) then
    raise exception 'حالة سنّ غير معروفة: %', new.condition;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_guard_tooth_procedure_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_check_tooth_shape(new.tooth_number, new.tooth_type, new.surfaces);
  if new.procedure_kind is not null
     and new.procedure_kind <> all(app_dental_procedure_kinds()) then
    raise exception 'نوع إجراء غير معروف: %', new.procedure_kind;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_tooth_status on patient_tooth_status;
create trigger trg_guard_tooth_status
  before insert or update on patient_tooth_status
  for each row execute function app_guard_tooth_status_row();

drop trigger if exists trg_guard_tooth_procedure on tooth_procedures;
create trigger trg_guard_tooth_procedure
  before insert or update on tooth_procedures
  for each row execute function app_guard_tooth_procedure_row();

-- ===========================================================================
-- 5) الدوالّ
-- ===========================================================================

-- وسم حال سنّ يدويًّا: ما يجده الطبيب عند الفحص (تسوّس، سنّ مفقود…).
create or replace function app_set_tooth_condition(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_tooth_number    text,
  p_condition       text,
  p_tooth_type      text default 'permanent',
  p_surfaces        text[] default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بتعديل السجل الطبي';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  insert into patient_tooth_status (organization_id, patient_id, tooth_number,
                                    tooth_type, condition, surfaces, note, updated_by)
  values (p_organization_id, p_patient_id, p_tooth_number,
          coalesce(p_tooth_type, 'permanent'), p_condition,
          coalesce(p_surfaces, '{}'), nullif(btrim(coalesce(p_note,'')), ''), auth.uid())
  on conflict (patient_id, tooth_number) do update
    set condition  = excluded.condition,
        tooth_type = excluded.tooth_type,
        surfaces   = excluded.surfaces,
        note       = excluded.note,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- تخطيط إجراءات على أسنان — دفعة واحدة، لأن الطبيب يخطّط للفم لا للسنّ.
create or replace function app_plan_tooth_procedures(
  p_organization_id uuid,
  p_patient_id      uuid,
  p_procedures      jsonb,   -- [{tooth, tooth_type, item_id, surfaces[], note}]
  p_doctor_id       uuid default null,
  p_visit_id        uuid default null,
  p_branch_id       uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   jsonb;
  v_n     integer := 0;
  v_kind  text;
  v_tooth text;
  v_type  text;
  v_item  uuid;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(p_organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بتعديل السجل الطبي';
  end if;
  if p_procedures is null or jsonb_typeof(p_procedures) <> 'array'
     or jsonb_array_length(p_procedures) = 0 then
    raise exception 'أضف إجراءً واحدًا على الأقل';
  end if;
  if not exists (select 1 from patients where id = p_patient_id
                  and organization_id = p_organization_id) then
    raise exception 'المريض غير موجود في هذه المنشأة';
  end if;

  for v_row in select * from jsonb_array_elements(p_procedures) loop
    v_tooth := v_row->>'tooth';
    v_type  := coalesce(v_row->>'tooth_type', 'permanent');
    v_item  := nullif(v_row->>'item_id','')::uuid;

    if v_item is not null then
      select dental_procedure_kind into v_kind from items
       where id = v_item and organization_id = p_organization_id;
      if not found then
        raise exception 'الخدمة غير موجودة في هذه المنشأة';
      end if;
    else
      v_kind := nullif(v_row->>'procedure_kind','');
    end if;

    insert into tooth_procedures (organization_id, branch_id, patient_id, visit_id,
                                  doctor_id, tooth_number, tooth_type, surfaces,
                                  item_id, procedure_kind, status, note, planned_by)
    values (p_organization_id, p_branch_id, p_patient_id, p_visit_id, p_doctor_id,
            v_tooth, v_type,
            coalesce((select array_agg(x) from jsonb_array_elements_text(
                        coalesce(v_row->'surfaces', '[]'::jsonb)) x), '{}'),
            v_item, v_kind, 'planned',
            nullif(btrim(coalesce(v_row->>'note','')), ''), auth.uid());
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- تنفيذ إجراء: يُختم منفَّذًا، وتُحدَّث حال السنّ، ويُضاف بند الخدمة للزيارة
-- إن كانت هناك زيارة وخدمة — عملية واحدة. الفصل بينها يعني إجراءً منفَّذًا
-- بلا فاتورة، أو مخطّطًا لا يتغيّر بعد أن جرى الفعل.
create or replace function app_complete_tooth_procedure(
  p_procedure_id uuid,
  p_note         text default null,
  p_visit_id     uuid default null,
  p_bill         boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_proc   tooth_procedures%rowtype;
  v_after  text;
  v_visit  uuid;
  v_vs     uuid;
  v_price  numeric;
begin
  select * into v_proc from tooth_procedures where id = p_procedure_id;
  if v_proc.id is null then
    raise exception 'الإجراء غير موجود';
  end if;
  if not app_is_member(v_proc.organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_permission(v_proc.organization_id, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بتعديل السجل الطبي';
  end if;
  if v_proc.status = 'completed' then
    raise exception 'الإجراء منفَّذ سلفًا';
  end if;
  if v_proc.status = 'cancelled' then
    raise exception 'الإجراء ملغى — لا يُنفَّذ';
  end if;

  v_visit := coalesce(p_visit_id, v_proc.visit_id);

  -- بند الخدمة في الزيارة: الجسر بين ما جرى سريريًّا وما يُفوتَر.
  if p_bill and v_proc.item_id is not null and v_visit is not null
     and v_proc.visit_service_id is null then
    select price into v_price from items where id = v_proc.item_id;
    insert into patient_visit_services (organization_id, visit_id, item_id,
                                        qty, unit_price, note, performed_by, created_by)
    values (v_proc.organization_id, v_visit, v_proc.item_id, 1,
            coalesce(v_price, 0),
            'سنّ ' || v_proc.tooth_number,
            -- `performed_by` في هذا الجدول يشير إلى `doctors` لا إلى
            -- `auth.users`: مَن نفّذ الخدمة طبيبٌ لا حسابُ مستخدم.
            v_proc.doctor_id, auth.uid())
    returning id into v_vs;
  end if;

  update tooth_procedures
     set status           = 'completed',
         performed_at     = now(),
         performed_by     = auth.uid(),
         visit_id         = v_visit,
         visit_service_id = coalesce(v_vs, visit_service_id),
         note             = coalesce(nullif(btrim(coalesce(p_note,'')), ''), note),
         updated_at       = now()
   where id = p_procedure_id;

  -- حال السنّ بعد الإجراء — من الخريطة الواحدة، وفقط حين يكون للإجراء أثر.
  v_after := app_tooth_condition_after(v_proc.procedure_kind);
  if v_after is not null then
    perform app_set_tooth_condition(v_proc.organization_id, v_proc.patient_id,
                                    v_proc.tooth_number, v_after,
                                    v_proc.tooth_type, v_proc.surfaces, null);
  end if;

  return p_procedure_id;
end;
$$;

create or replace function app_cancel_tooth_procedure(
  p_procedure_id uuid,
  p_reason       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; v_status text;
begin
  select organization_id, status into v_org, v_status
    from tooth_procedures where id = p_procedure_id;
  if v_org is null then raise exception 'الإجراء غير موجود'; end if;
  if not app_is_member(v_org) then raise exception 'لا تنتمي لهذه المنشأة'; end if;
  if not app_has_permission(v_org, 'medical_records.write') then
    raise exception 'صلاحيتك لا تسمح بتعديل السجل الطبي';
  end if;
  if v_status = 'completed' then
    raise exception 'الإجراء منفَّذ — لا يُلغى. الإلغاء بعد التنفيذ يمحو أثرًا سريريًّا وقع فعلًا';
  end if;
  if v_status = 'cancelled' then
    raise exception 'الإجراء ملغى سلفًا';
  end if;

  update tooth_procedures
     set status = 'cancelled',
         cancel_reason = nullif(btrim(coalesce(p_reason,'')), ''),
         updated_at = now()
   where id = p_procedure_id;
end;
$$;

do $$
declare v_sig regprocedure;
begin
  for v_sig in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('app_set_tooth_condition','app_plan_tooth_procedures',
                         'app_complete_tooth_procedure','app_cancel_tooth_procedure',
                         'app_is_valid_tooth','app_tooth_surface_keys',
                         'app_tooth_condition_keys','app_dental_procedure_kinds',
                         'app_tooth_condition_after','app_check_tooth_shape',
                         'app_derive_dental_kind')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

-- ===========================================================================
-- 6) العروض
-- ===========================================================================

-- المخطّط: كل سنٍّ لهذا المريض بحالته وعدد ما ينتظره.
drop view if exists v_patient_odontogram;
create view v_patient_odontogram
with (security_invoker = on) as
select s.patient_id,
       s.organization_id,
       s.tooth_number,
       s.tooth_type,
       s.condition,
       s.surfaces,
       s.note,
       s.updated_at,
       (select count(*) from tooth_procedures p
         where p.patient_id = s.patient_id
           and p.tooth_number = s.tooth_number
           and p.status = 'planned')   as planned_count,
       (select count(*) from tooth_procedures p
         where p.patient_id = s.patient_id
           and p.tooth_number = s.tooth_number
           and p.status = 'completed') as completed_count
  from patient_tooth_status s;

comment on view v_patient_odontogram is
  'حال أسنان المريض الآن — ما يلوّنه المخطّط، مع عدد المخطَّط والمنفَّذ لكل سنّ.';

-- تاريخ ما جرى لكل سنّ.
drop view if exists v_tooth_procedure_history;
create view v_tooth_procedure_history
with (security_invoker = on) as
select p.id,
       p.organization_id,
       p.branch_id,
       p.patient_id,
       p.tooth_number,
       p.tooth_type,
       p.surfaces,
       p.status,
       p.procedure_kind,
       p.item_id,
       i.name_ar        as item_name,
       i.price          as item_price,
       p.doctor_id,
       d.name_ar        as doctor_name,
       p.visit_id,
       p.visit_service_id,
       p.agreement_item_id,
       p.note,
       p.planned_at,
       p.performed_at,
       p.cancel_reason
  from tooth_procedures p
  left join items i on i.id = p.item_id
  left join doctors d on d.id = p.doctor_id;

comment on view v_tooth_procedure_history is
  'كل إجراء على سنّ: ما هو، ومتى خُطِّط، ومتى نُفِّذ، وبأيّ خدمة فُوتِر.';

-- خطة العلاج السنّية: المخطَّط الذي لم يُنفَّذ بعد، وكلفته.
drop view if exists v_dental_treatment_plan;
create view v_dental_treatment_plan
with (security_invoker = on) as
select p.patient_id,
       p.organization_id,
       count(*)                                       as planned_items,
       count(distinct p.tooth_number)                 as teeth_count,
       coalesce(sum(i.price), 0)                      as estimated_total,
       min(p.planned_at)                              as first_planned_at,
       string_agg(distinct p.tooth_number, ', ' order by p.tooth_number) as teeth
  from tooth_procedures p
  left join items i on i.id = p.item_id
 where p.status = 'planned'
 group by p.patient_id, p.organization_id;

comment on view v_dental_treatment_plan is
  'ما خُطّط ولم يُنفَّذ بعد لكل مريض، وكلفته التقديرية من أسعار الخدمات.';

-- ===========================================================================
-- 7) تحقّق فوريّ
-- ===========================================================================
do $zc_verify$
declare v_n int;
begin
  if to_regprocedure('public.app_plan_tooth_procedures(uuid,uuid,jsonb,uuid,uuid,uuid)') is null
     or to_regprocedure('public.app_complete_tooth_procedure(uuid,text,uuid,boolean)') is null
     or to_regprocedure('public.app_set_tooth_condition(uuid,uuid,text,text,text,text[],text)') is null then
    raise exception 'دالّة واحدة أو أكثر لم تُنشأ بالتوقيع المتوقَّع';
  end if;

  -- الأرقام: 11 سنّ صالح، 19 و 09 و 51-دائم ليست كذلك.
  if not app_is_valid_tooth('11') or not app_is_valid_tooth('48')
     or not app_is_valid_tooth('55', 'primary') then
    raise exception 'حارس أرقام الأسنان يرفض رقمًا صالحًا';
  end if;
  if app_is_valid_tooth('19') or app_is_valid_tooth('09')
     or app_is_valid_tooth('55') or app_is_valid_tooth('11', 'primary') then
    raise exception 'حارس أرقام الأسنان يقبل رقمًا غير صالح';
  end if;

  -- الخريطة: الخلع يُنتج extracted، والتنظيف لا يغيّر شيئًا.
  if app_tooth_condition_after('extraction') <> 'extracted' then
    raise exception 'خريطة الحالات: الخلع لا يُنتج extracted';
  end if;
  if app_tooth_condition_after('cleaning') is not null then
    raise exception 'خريطة الحالات: التنظيف يغيّر حال السنّ بلا داعٍ';
  end if;

  select count(*) into v_n from pg_trigger
   where tgname in ('trg_guard_tooth_status','trg_guard_tooth_procedure',
                    'trg_fill_dental_kind');
  if v_n <> 3 then raise exception 'حرّاس جداول الأسنان لم يُركَّبوا'; end if;

  -- الاستنتاج يعمل على ما يُكتب لا على ما كُتب فقط.
  if app_derive_dental_kind('خلع ضرس العقل') <> 'extraction'
     or app_derive_dental_kind('كشفية') is not null then
    raise exception 'استنتاج نوع إجراء الأسنان لا يعمل كما ينبغي';
  end if;
end
$zc_verify$;
