-- ---------------------------------------------------------------------------
-- 0066_patient_profile_and_merge.sql — إكمال ملف المريض ودمج المكرَّر
-- ---------------------------------------------------------------------------
-- ثلاثة نواقص في ملف المريض:
--
--   • **لا مرافقون ولا جهات اتصال.** رقم واحد للطوارئ في عمود نصّي
--     (`emergency_number`) بلا اسم ولا صلة قرابة ولا تفويض. فمن يُتصل به حين
--     يُغمى على مريض؟ ومن يحقّ له استلام نتيجته؟
--
--   • **لا كشف تكرار.** لا شيء يمنع فتح ملف ثانٍ لنفس الشخص بنفس الهوية أو
--     الجوال. والتكرار الصامت أسوأ من رفض الإنشاء: تاريخ المريض ينقسم بين
--     ملفين، فيُشخَّص على نصف سجله.
--
--   • **لا دمج.** حين يُكتشف التكرار لا سبيل إلا الحذف — وهو يمحو تاريخًا
--     طبيًا وفواتير صادرة.
--
-- ولا انتهاء صلاحية للمستندات: موافقة وقّعها المريض قبل ثلاث سنوات تبدو
-- سارية إلى الأبد.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) جهات الاتصال والمرافقون
-- ---------------------------------------------------------------------------
create table if not exists patient_contacts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  patient_id            uuid not null references patients(id) on delete cascade,
  full_name             text not null,
  relation              text,
  mobile_number         text,
  is_emergency_contact  boolean not null default false,
  -- التفويض قرار قانوني لا تفصيل اجتماعي: من يُسمح له باستلام نتيجة تحليل
  -- أو تقرير أشعة. الافتراضي «لا» لأن الأصل في المعلومة الطبية السرّية.
  authorized_to_receive boolean not null default false,
  companion_type        text not null default 'temporary'
                          check (companion_type in ('primary', 'temporary')),
  note                  text,
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_patient_contacts_patient on patient_contacts (patient_id);
create index if not exists idx_patient_contacts_org on patient_contacts (organization_id);

alter table patient_contacts drop constraint if exists patient_contacts_patient_tenant_fk;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'patients_organization_id_id_key') then
    alter table patient_contacts add constraint patient_contacts_patient_tenant_fk
      foreign key (organization_id, patient_id) references patients(organization_id, id);
  end if;
end $$;

alter table patient_contacts enable row level security;
drop policy if exists "patient_contacts_read" on patient_contacts;
create policy "patient_contacts_read" on patient_contacts
  for select using (app_is_member(organization_id) and app_has_permission(organization_id, 'patients.view'));
drop policy if exists "patient_contacts_write" on patient_contacts;
create policy "patient_contacts_write" on patient_contacts
  for all using (app_has_permission(organization_id, 'patients.update'))
  with check (app_has_permission(organization_id, 'patients.update'));
revoke all on patient_contacts from anon;
grant select, insert, update, delete on patient_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- 2) صلاحية المستندات والموافقات
-- ---------------------------------------------------------------------------
alter table patient_documents
  add column if not exists expires_at   date,
  add column if not exists is_consent   boolean not null default false,
  add column if not exists signed_at    timestamptz;

create index if not exists idx_patient_documents_expiry
  on patient_documents (organization_id, expires_at) where expires_at is not null;

-- ---------------------------------------------------------------------------
-- 3) أعمدة الدمج على المريض
--
-- السجل المكرَّر **لا يُحذف**: يُعلَّم مدموجًا ويشير إلى الأصل. الحذف كان
-- سيكسر كل مرجع قديم — رقم ملف مكتوب على وصفة ورقية، أو فاتورة مطبوعة.
-- ---------------------------------------------------------------------------
alter table patients
  add column if not exists merged_into_id uuid references patients(id) on delete set null,
  add column if not exists merged_at      timestamptz,
  add column if not exists merged_by      uuid references auth.users(id),
  add column if not exists merge_reason   text;

create index if not exists idx_patients_merged on patients (merged_into_id) where merged_into_id is not null;

-- مريض مدموج لا يُحجز له: أي حجز جديد يجب أن يقع على الملف الأصلي، وإلا
-- انقسم التاريخ من جديد بعد الدمج مباشرةً.
create or replace function app_enforce_merged_patient()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_target uuid;
begin
  select merged_into_id into v_target from patients where id = new.patient_id;
  if v_target is not null then
    raise exception 'هذا الملف مدموج في ملف آخر — استخدم الملف الأصلي (%)', v_target;
  end if;
  return new;
end;
$$;

-- الاسم يبدأ بـ`a_` عمدًا: المُحفِّزات تعمل بترتيب أسمائها، وهذا يجب أن
-- يسبق حارس الحظر (0063) وإلا ظهرت رسالة «محظور من الحجز» بدل الرسالة
-- الصحيحة «الملف مدموج — استخدم الأصلي»، فيبحث الموظف عن حظر لا وجود له.
drop trigger if exists trg_enforce_merged_patient on appointments;
drop trigger if exists trg_a_merged_patient on appointments;
create trigger trg_a_merged_patient
before insert on appointments
for each row execute function app_enforce_merged_patient();

-- ---------------------------------------------------------------------------
-- 3ب) رسالة الحظر تقرأ سبب الملف أيضًا
--
-- حارس 0063 كان يقرأ السبب من `blocked_external_contacts` وحده، فمريض
-- محظور عبر `patients.block_appointments` — وله سبب مكتوب في ملفه — تظهر
-- له «بلا سبب مسجَّل». السبب موجود ولا يُقرأ.
-- ---------------------------------------------------------------------------
create or replace function app_enforce_booking_block()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mobile      text;
  v_file_reason text;
  v_list_reason text;
begin
  select p.mobile_number, nullif(btrim(p.block_appointments_reason), '')
    into v_mobile, v_file_reason
    from patients p where p.id = new.patient_id;

  if app_check_contact_block(new.organization_id, new.patient_id, v_mobile, 'booking') then
    -- متغيّر منفصل: `select into` بلا صفوف يضع NULL في هدفه، فاستعمال
    -- المتغيّر نفسه كان يمحو سبب الملف حين لا يوجد سجل حظر — وهو الحال
    -- الأشيع، إذ أكثر الحظر يقع من ملف المريض لا من قائمة الجهات.
    select nullif(btrim(b.reason), '')
      into v_list_reason
      from blocked_external_contacts b
     where b.organization_id = new.organization_id
       and b.is_active
       and b.starts_at <= now()
       and (b.ends_at is null or b.ends_at > now())
       and b.block_type in ('booking', 'all')
       and (b.patient_id = new.patient_id
            or app_normalize_mobile(b.mobile_number) = app_normalize_mobile(v_mobile))
     order by b.created_at desc
     limit 1;

    raise exception 'هذا المريض محظور من حجز المواعيد — السبب: %. ارفع الحظر من ملف المريض أو شاشة الجهات المحجوبة للمتابعة.',
      coalesce(v_list_reason, v_file_reason, 'بلا سبب مسجَّل');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) كشف التكرار — يُعرض لا يمنع
--
-- الاقتراح لا الرفض: توأمان بنفس الاسم وتاريخ الميلاد واقع، وأمٌّ تُسجّل
-- رضيعها برقم جوالها واقع أشيع. المنع التلقائي كان سيمنع حالات صحيحة
-- ويُعلّم الموظف تجاوز التحذير بأي حيلة. العرض يجعله يقرّر وهو يرى.
--
-- الترتيب بقوّة التطابق: الهوية أقوى من الجوال، والجوال أقوى من الاسم
-- والميلاد.
-- ---------------------------------------------------------------------------
create or replace function app_find_duplicate_patients(
  p_organization_id uuid,
  p_id_number       text default null,
  p_passport_number text default null,
  p_mobile_number   text default null,
  p_name_ar         text default null,
  p_birth_date      date default null,
  p_exclude_id      uuid default null
)
returns table (
  patient_id   uuid,
  name_ar      text,
  file_number  text,
  mobile_number text,
  id_number    text,
  birth_date   date,
  match_reason text,
  match_score  integer
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.id, p.name_ar, p.file_number::text, p.mobile_number, p.id_number, p.birth_date,
         m.reason, m.score
  from patients p
  cross join lateral (
    select
      case
        when nullif(btrim(p_id_number),'') is not null and p.id_number = btrim(p_id_number)       then 'تطابق رقم الهوية'
        when nullif(btrim(p_passport_number),'') is not null and p.passport_number = btrim(p_passport_number) then 'تطابق رقم الجواز'
        when app_normalize_mobile(p_mobile_number) is not null
             and app_normalize_mobile(p.mobile_number) = app_normalize_mobile(p_mobile_number)     then 'تطابق رقم الجوال'
        when nullif(btrim(p_name_ar),'') is not null and p_birth_date is not null
             and p.name_ar = btrim(p_name_ar) and p.birth_date = p_birth_date                      then 'تطابق الاسم وتاريخ الميلاد'
      end as reason,
      case
        when nullif(btrim(p_id_number),'') is not null and p.id_number = btrim(p_id_number)       then 100
        when nullif(btrim(p_passport_number),'') is not null and p.passport_number = btrim(p_passport_number) then 90
        when app_normalize_mobile(p_mobile_number) is not null
             and app_normalize_mobile(p.mobile_number) = app_normalize_mobile(p_mobile_number)     then 70
        when nullif(btrim(p_name_ar),'') is not null and p_birth_date is not null
             and p.name_ar = btrim(p_name_ar) and p.birth_date = p_birth_date                      then 60
      end as score
  ) m
  where p.organization_id = p_organization_id
    and p.merged_into_id is null
    and (p_exclude_id is null or p.id <> p_exclude_id)
    and m.reason is not null
  order by m.score desc, p.created_at
  limit 10;
$$;

comment on function app_find_duplicate_patients(uuid, text, text, text, text, date, uuid) is
  'يقترح ملفات قد تكون لنفس الشخص، مرتَّبة بقوّة التطابق (هوية 100، جواز 90، جوال 70، اسم+ميلاد 60). اقتراح لا منع.';

revoke all on function app_find_duplicate_patients(uuid, text, text, text, text, date, uuid) from public, anon;
grant execute on function app_find_duplicate_patients(uuid, text, text, text, text, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) الدمج
--
-- **النقل يدور على `pg_constraint` لا على قائمة مكتوبة بالأسماء.** قائمة
-- ثابتة تنسى جدولًا يُضاف بعد شهر، فيبقى مرتبطًا بالملف المكرَّر بلا أن
-- يلاحظ أحد — وهذا أسوأ من فشل صريح. الحلقة تشمل كل ما يشير إلى `patients`
-- اليوم وغدًا.
-- ---------------------------------------------------------------------------
create or replace function app_merge_patients(
  p_primary_patient_id   uuid,
  p_duplicate_patient_id uuid,
  p_reason               text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primary   patients%rowtype;
  v_duplicate patients%rowtype;
  r           record;
  v_moved     jsonb := '{}'::jsonb;
  v_count     integer;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;
  if p_primary_patient_id = p_duplicate_patient_id then
    raise exception 'لا يمكن دمج الملف في نفسه';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'سبب الدمج مطلوب';
  end if;

  -- القفل بترتيب ثابت (الأصغر أولًا) يمنع جمودًا لو حاول موظفان دمج نفس
  -- الملفين بترتيب معكوس.
  if p_primary_patient_id < p_duplicate_patient_id then
    select * into v_primary   from patients where id = p_primary_patient_id   for update;
    select * into v_duplicate from patients where id = p_duplicate_patient_id for update;
  else
    select * into v_duplicate from patients where id = p_duplicate_patient_id for update;
    select * into v_primary   from patients where id = p_primary_patient_id   for update;
  end if;

  if v_primary.id is null or v_duplicate.id is null then
    raise exception 'أحد الملفين غير موجود';
  end if;
  if v_primary.organization_id <> v_duplicate.organization_id then
    raise exception 'لا يمكن دمج ملفين من منشأتين مختلفتين';
  end if;
  if not app_has_permission(v_primary.organization_id, 'patients.merge') then
    raise exception 'صلاحيتك لا تسمح بدمج ملفات المرضى';
  end if;
  if v_duplicate.merged_into_id is not null then
    raise exception 'الملف المكرَّر مدموج أصلًا';
  end if;
  if v_primary.merged_into_id is not null then
    raise exception 'الملف الأساسي نفسه مدموج في ملف ثالث — ادمج في الأصل مباشرةً';
  end if;

  -- الحالات الصحية أولًا: مفتاحها (patient_id, condition_id)، فالنقل الأعمى
  -- يصطدم بمفتاح مكرَّر. تُنقل غير المكرَّرة ويُحذف الباقي — وهي علامات
  -- منطقية لا سجلات سريرية، فلا يضيع بحذفها شيء.
  delete from patient_health_conditions d
   where d.patient_id = p_duplicate_patient_id
     and exists (select 1 from patient_health_conditions k
                  where k.patient_id = p_primary_patient_id
                    and k.condition_id = d.condition_id);

  for r in
    select c.conrelid::regclass::text as tbl,
           a.attname                  as col
      from pg_constraint c
      join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and c.confrelid = 'patients'::regclass
       and a.attname <> 'organization_id'          -- عمود المنشأة في القيود المركّبة لا يُنقل
       and c.conrelid <> 'patients'::regclass      -- عمود merged_into_id على المرضى أنفسهم
     order by 1, 2
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col)
      using p_primary_patient_id, p_duplicate_patient_id;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_moved := v_moved || jsonb_build_object(r.tbl || '.' || r.col, v_count);
    end if;
  end loop;

  -- الملف المكرَّر يبقى، مُعلَّمًا. ورقم ملفه يبقى معه: مكتوبٌ على وصفات
  -- ورقية وفواتير مطبوعة، وتغييره يجعلها غير قابلة للتتبّع.
  update patients
     set merged_into_id = p_primary_patient_id,
         merged_at      = now(),
         merged_by      = auth.uid(),
         merge_reason   = btrim(p_reason),
         block_appointments = true,
         block_appointments_reason = 'ملف مدموج — استخدم الملف الأصلي',
         updated_at     = now()
   where id = p_duplicate_patient_id;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details, reason)
  values (
    v_primary.organization_id, auth.uid(), 'update', 'patients', p_primary_patient_id,
    format('دمج ملف %s في %s', coalesce(v_duplicate.file_number::text, '؟'), coalesce(v_primary.file_number::text, '؟')),
    jsonb_build_object(
      'primary',   jsonb_build_object('id', p_primary_patient_id,   'name', v_primary.name_ar,   'file_number', v_primary.file_number),
      'duplicate', jsonb_build_object('id', p_duplicate_patient_id, 'name', v_duplicate.name_ar, 'file_number', v_duplicate.file_number),
      'moved',     v_moved
    )::text,
    btrim(p_reason)
  );

  return jsonb_build_object(
    'primary_patient_id', p_primary_patient_id,
    'duplicate_patient_id', p_duplicate_patient_id,
    'moved', v_moved
  );
end;
$$;

comment on function app_merge_patients(uuid, uuid, text) is
  'دمج ملف مكرَّر في الأصل: ينقل كل ما يشير إلى المريض (بحلقة على pg_constraint لا بقائمة أسماء)، ويُعلّم المكرَّر مدموجًا بلا حذف، ويكتب قيد تدقيق بما نُقل.';

revoke all on function app_merge_patients(uuid, uuid, text) from public, anon;
grant execute on function app_merge_patients(uuid, uuid, text) to authenticated;

commit;
