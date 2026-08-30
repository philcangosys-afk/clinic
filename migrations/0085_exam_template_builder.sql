-- 0085_exam_template_builder.sql
-- المرحلة الخامسة: مصمّم نماذج الفحص السريري.
--
-- الحالة قبل هذا الملف: `clinic_exam_templates` يخزّن النموذج كله في عمود
-- `schema_definition jsonb` واحد، وأنواع الحقول أربعة فقط (نصّ، نصّ طويل،
-- تشخيص، مجموعة). ولا وحدات قياس، ولا حقول إلزامية، ولا إظهار شرطي، ولا
-- إصدارات.
--
-- ونتيجة الأخيرة أخطر مما تبدو: **تعديل نموذج مستعمَل يغيّر معنى الزيارات
-- القديمة**. حقلٌ اسمه `chest` كان «فحص الصدر» فصار «ألم الصدر» — وكل زيارة
-- سابقة تُقرأ الآن بالمعنى الجديد. لا شيء في المخطط يمنع ذلك.
--
-- ---------------------------------------------------------------------------
-- قراران في إعادة الاستعمال
-- ---------------------------------------------------------------------------
--
--   1) **`clinic_exam_templates` يبقى رأسًا للنموذج** ولا يُنشأ جدول قوالب
--      ثانٍ. تُضاف إليه أعمدة الإصدار والسريان والعيادة.
--
--   2) **`schema_definition` يبقى ويصير مشتقًّا.** شاشة السجل الطبي تقرؤه
--      اليوم، وحذفه يكسرها فورًا. صار يُبنى تلقائيًا من الجداول المعيارية
--      بمشغّل، فلا يفترق التمثيلان — والشاشة تُهاجَر إلى الجداول على مهل.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) رأس النموذج
-- ---------------------------------------------------------------------------
alter table clinic_exam_templates
  add column if not exists specialty_value_id uuid references lookup_values(id) on delete set null,
  add column if not exists clinic_id          uuid references clinics(id) on delete set null,
  add column if not exists version            integer not null default 1,
  add column if not exists parent_template_id uuid references clinic_exam_templates(id) on delete set null,
  add column if not exists effective_from     date not null default current_date,
  add column if not exists effective_to       date,
  add column if not exists description_ar     text,
  add column if not exists created_by         uuid references auth.users(id),
  add column if not exists updated_by         uuid references auth.users(id);

comment on column clinic_exam_templates.is_disabled is 'حالة النموذج. لا يوجد is_active — علَمان لمعنى واحد يتناقضان.';
comment on column clinic_exam_templates.schema_definition is
  'يُبنى تلقائيًا من exam_template_sections/fields. لا يُحرَّر يدويًا — التحرير يفترق عن الجداول.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_templates_version_check') then
    alter table clinic_exam_templates add constraint exam_templates_version_check check (version >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exam_templates_clinic_tenant_fk') then
    alter table clinic_exam_templates add constraint exam_templates_clinic_tenant_fk
      foreign key (organization_id, clinic_id) references clinics (organization_id, id) not valid;
  end if;
end $$;

create index if not exists idx_exam_templates_specialty
  on clinic_exam_templates (organization_id, specialty_value_id) where not is_disabled;

-- **مفتاح `(organization_id, specialty_code)` الفريد يمنع الإصدارات أصلًا.**
--
-- كان يقول «نموذج واحد لكل تخصص»، وهو معنًى صحيح — لكنه بصيغته المطلقة
-- يمنع وجود نسخة ثانية من النموذج نفسه، أي يمنع الإصدارات التي تقوم عليها
-- هذه المرحلة كلها. يُستبدل بفهرس جزئي يحفظ المعنى: **نموذج مفعَّل واحد**
-- لكل تخصص، وأي عدد من النسخ المعطَّلة أو المؤرشفة.
alter table clinic_exam_templates
  drop constraint if exists clinic_exam_templates_organization_id_specialty_code_key;

create unique index if not exists uq_exam_template_active_specialty
  on clinic_exam_templates (organization_id, specialty_code)
  where not is_disabled and specialty_code is not null;

-- ---------------------------------------------------------------------------
-- 2) الأقسام والحقول والخيارات
-- ---------------------------------------------------------------------------
create table if not exists exam_template_sections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id     uuid not null references clinic_exam_templates(id) on delete cascade,
  key             text not null,
  name_ar         text not null,
  name_en         text,
  description_ar  text,
  sort_order      integer not null default 0,
  is_collapsible  boolean not null default false,
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_exam_sections on exam_template_sections (template_id, key);

create table if not exists exam_template_fields (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  template_id       uuid not null references clinic_exam_templates(id) on delete cascade,
  section_id        uuid not null references exam_template_sections(id) on delete cascade,
  key               text not null,
  label_ar          text not null,
  label_en          text,
  field_type        text not null,
  unit              text,
  placeholder_ar    text,
  help_ar           text,
  is_required       boolean not null default false,
  min_value         numeric(14,4),
  max_value         numeric(14,4),
  decimal_places    smallint,
  default_value     text,
  -- الإظهار الشرطي: يظهر هذا الحقل حين تكون قيمة حقل آخر مساويةً لقيمة
  visible_when_field_id uuid references exam_template_fields(id) on delete set null,
  visible_when_value    text,
  lookup_category_key   text,
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint exam_fields_type_check check (field_type in (
    'text','textarea','number','date','time','select','multi_select',
    'checkbox','radio','yes_no','measurement','clinical_code','body_map','file'
  )),
  constraint exam_fields_range_check
    check (min_value is null or max_value is null or min_value <= max_value),
  -- الإظهار الشرطي ناقصٌ لا معنى له: حقلٌ بلا قيمة، أو قيمةٌ بلا حقل.
  constraint exam_fields_conditional_check check (
    (visible_when_field_id is null and visible_when_value is null)
    or (visible_when_field_id is not null and visible_when_value is not null)
  )
);

create unique index if not exists uq_exam_fields on exam_template_fields (template_id, key);
create index if not exists idx_exam_fields_section on exam_template_fields (section_id) where is_active;

create table if not exists exam_field_options (
  id         uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  field_id   uuid not null references exam_template_fields(id) on delete cascade,
  value      text not null,
  label_ar   text not null,
  label_en   text,
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

create unique index if not exists uq_exam_field_options on exam_field_options (field_id, value);

-- الحقل الشرطي يجب أن يكون من النموذج نفسه
create or replace function app_enforce_exam_field_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_section_template uuid;
  v_cond_template    uuid;
begin
  select template_id into v_section_template from exam_template_sections where id = new.section_id;
  if v_section_template is distinct from new.template_id then
    raise exception 'القسم يتبع نموذجًا آخر';
  end if;

  if new.visible_when_field_id is not null then
    select template_id into v_cond_template from exam_template_fields where id = new.visible_when_field_id;
    if v_cond_template is distinct from new.template_id then
      raise exception 'الحقل الشرطي يتبع نموذجًا آخر';
    end if;
    if new.visible_when_field_id = new.id then
      raise exception 'الحقل لا يكون شرطًا لظهور نفسه';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_exam_field_scope on exam_template_fields;
create trigger trg_exam_field_scope
  before insert or update on exam_template_fields
  for each row execute function app_enforce_exam_field_scope();

-- ---------------------------------------------------------------------------
-- 3) بناء `schema_definition` من الجداول
--
-- التمثيلان يبقيان متطابقين لأن أحدهما مشتقّ من الآخر — لا لأن أحدًا
-- يتذكّر تحديثهما معًا.
-- ---------------------------------------------------------------------------
create or replace function app_rebuild_exam_schema(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schema jsonb;
begin
  select jsonb_build_object(
           'version', (select version from clinic_exam_templates where id = p_template_id),
           'sections', coalesce(jsonb_agg(sec order by sec_order), '[]'::jsonb))
    into v_schema
    from (
      select s.sort_order as sec_order,
             jsonb_build_object(
               'key', s.key,
               'label_ar', s.name_ar,
               'type', 'group',
               'fields', coalesce(
                 (select jsonb_agg(jsonb_build_object(
                            'key', f.key,
                            'label_ar', f.label_ar,
                            'type', f.field_type,
                            'unit', f.unit,
                            'required', f.is_required,
                            'options', (select jsonb_agg(jsonb_build_object('value', o.value, 'label_ar', o.label_ar)
                                                         order by o.sort_order)
                                          from exam_field_options o
                                         where o.field_id = f.id and o.is_active),
                            'visible_when', case when f.visible_when_field_id is null then null
                              else jsonb_build_object(
                                'field', (select k.key from exam_template_fields k where k.id = f.visible_when_field_id),
                                'value', f.visible_when_value) end)
                          order by f.sort_order)
                    from exam_template_fields f
                   where f.section_id = s.id and f.is_active),
                 '[]'::jsonb)
             ) as sec
        from exam_template_sections s
       where s.template_id = p_template_id
    ) z;

  update clinic_exam_templates
     set schema_definition = coalesce(v_schema, jsonb_build_object('sections', '[]'::jsonb)),
         updated_at = now()
   where id = p_template_id;

  return v_schema;
end;
$$;

create or replace function app_touch_exam_schema()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template uuid;
begin
  -- `if` لا `case` داخل تعبير واحد: الدالة مشتركة بين ثلاثة جداول، وتعبيرٌ
  -- واحد يشير إلى `new.field_id` و`new.template_id` معًا يُصرَّف كاستعلام
  -- واحد فيفشل على الجدول الذي ينقصه أحد الحقلين.
  if tg_table_name = 'exam_field_options' then
    select template_id into v_template from exam_template_fields
     where id = coalesce(new.field_id, old.field_id);
  else
    v_template := coalesce(new.template_id, old.template_id);
  end if;

  if v_template is not null then
    perform app_rebuild_exam_schema(v_template);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_exam_sections_schema on exam_template_sections;
create trigger trg_exam_sections_schema
  after insert or update or delete on exam_template_sections
  for each row execute function app_touch_exam_schema();

drop trigger if exists trg_exam_fields_schema on exam_template_fields;
create trigger trg_exam_fields_schema
  after insert or update or delete on exam_template_fields
  for each row execute function app_touch_exam_schema();

drop trigger if exists trg_exam_options_schema on exam_field_options;
create trigger trg_exam_options_schema
  after insert or update or delete on exam_field_options
  for each row execute function app_touch_exam_schema();

-- ---------------------------------------------------------------------------
-- 4) الزيارة تحتفظ بنسخة النموذج المستعمَلة
--
-- أهمّ بند في هذه المرحلة. بدونه، تعديل نموذج اليوم يغيّر **معنى** ما كُتب
-- قبل سنة: حقلٌ حُذف تختفي إجابته من العرض، وحقلٌ أُعيدت تسميته تُقرأ إجابته
-- القديمة بالعنوان الجديد. النسخة تُلتقط مرة واحدة عند أول حفظ ولا تتغيّر.
-- ---------------------------------------------------------------------------
alter table patient_visits
  add column if not exists exam_schema_snapshot jsonb,
  add column if not exists template_version     integer;

create or replace function app_snapshot_exam_template()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.template_id is null then
    return new;
  end if;
  -- تُلتقط مرة واحدة: إعادة الالتقاط عند كل تعديل تُلغي الغرض.
  if new.exam_schema_snapshot is null then
    select schema_definition, version
      into new.exam_schema_snapshot, new.template_version
      from clinic_exam_templates where id = new.template_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_exam_template on patient_visits;
create trigger trg_snapshot_exam_template
  before insert or update of template_id on patient_visits
  for each row execute function app_snapshot_exam_template();

-- ---------------------------------------------------------------------------
-- 5) إصدار نسخة جديدة بدل تعديل نموذج مستعمَل
-- ---------------------------------------------------------------------------
create or replace function app_template_usage_count(p_template_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from patient_visits v
   where v.template_id = p_template_id and app_is_member(v.organization_id);
$$;

create or replace function app_clone_exam_template(
  p_template_id uuid,
  p_name_ar     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src    clinic_exam_templates%rowtype;
  v_new    uuid;
  v_ver    int;
  r        record;
  v_map    jsonb := '{}'::jsonb;
begin
  select * into v_src from clinic_exam_templates where id = p_template_id;
  if v_src.id is null then
    raise exception 'النموذج غير موجود';
  end if;
  if not app_has_permission(v_src.organization_id, 'exam_templates.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة النماذج';
  end if;

  select coalesce(max(version), 0) + 1 into v_ver
    from clinic_exam_templates
   where organization_id = v_src.organization_id
     and coalesce(parent_template_id, id) = coalesce(v_src.parent_template_id, v_src.id);

  insert into clinic_exam_templates (organization_id, specialty_code, specialty_value_id, clinic_id,
                                     name_ar, name_en, description_ar, note, canvas_type,
                                     schema_definition, version, parent_template_id,
                                     effective_from, is_disabled, created_by, updated_by)
  values (v_src.organization_id, v_src.specialty_code, v_src.specialty_value_id, v_src.clinic_id,
          coalesce(p_name_ar, v_src.name_ar || ' — نسخة ' || v_ver),
          v_src.name_en, v_src.description_ar, v_src.note, v_src.canvas_type,
          v_src.schema_definition, v_ver, coalesce(v_src.parent_template_id, v_src.id),
          current_date, true, auth.uid(), auth.uid())
  returning id into v_new;

  -- الأقسام أولًا، ثم الحقول (لأنها تشير إلى الأقسام)، ثم الخيارات.
  for r in select * from exam_template_sections where template_id = p_template_id loop
    insert into exam_template_sections (organization_id, template_id, key, name_ar, name_en,
                                        description_ar, sort_order, is_collapsible)
    values (v_src.organization_id, v_new, r.key, r.name_ar, r.name_en,
            r.description_ar, r.sort_order, r.is_collapsible);
  end loop;

  for r in select * from exam_template_fields where template_id = p_template_id order by sort_order loop
    insert into exam_template_fields (organization_id, template_id, section_id, key, label_ar, label_en,
                                      field_type, unit, placeholder_ar, help_ar, is_required,
                                      min_value, max_value, decimal_places, default_value,
                                      lookup_category_key, sort_order, is_active)
    select v_src.organization_id, v_new,
           (select ns.id from exam_template_sections ns
             where ns.template_id = v_new
               and ns.key = (select os.key from exam_template_sections os where os.id = r.section_id)),
           r.key, r.label_ar, r.label_en, r.field_type, r.unit, r.placeholder_ar, r.help_ar,
           r.is_required, r.min_value, r.max_value, r.decimal_places, r.default_value,
           r.lookup_category_key, r.sort_order, r.is_active;
  end loop;

  -- الشروط تُربط بعد إنشاء كل الحقول، لأنها تشير إلى حقول قد تأتي لاحقًا.
  update exam_template_fields nf
     set visible_when_field_id = (
           select nk.id from exam_template_fields nk
            where nk.template_id = v_new
              and nk.key = (select ok.key from exam_template_fields ok
                             where ok.id = of.visible_when_field_id)),
         visible_when_value = of.visible_when_value
    from exam_template_fields of
   where of.template_id = p_template_id
     and of.visible_when_field_id is not null
     and nf.template_id = v_new
     and nf.key = of.key;

  for r in select o.*, f.key as field_key from exam_field_options o
             join exam_template_fields f on f.id = o.field_id
            where f.template_id = p_template_id loop
    insert into exam_field_options (organization_id, field_id, value, label_ar, label_en,
                                    sort_order, is_active)
    select v_src.organization_id,
           (select nf.id from exam_template_fields nf
             where nf.template_id = v_new and nf.key = r.field_key),
           r.value, r.label_ar, r.label_en, r.sort_order, r.is_active;
  end loop;

  perform app_rebuild_exam_schema(v_new);
  return v_new;
end;
$$;

-- تعديل نموذج استُعمل: تحذير في القاعدة لا منع
--
-- المنع الكامل يوقف تصحيح خطأ إملائي في عنوان حقل. والسماح الصامت يغيّر
-- معنى القديم. الحلّ: النسخة الملتقطة على الزيارة تحمي القديم، وهذا المشغّل
-- يمنع **تغيير نوع الحقل ومفتاحه** تحديدًا — وهما وحدهما ما يفسد قراءة
-- الإجابات المحفوظة.
create or replace function app_guard_used_template_field()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.key = new.key and old.field_type = new.field_type then
    return new;
  end if;
  if app_template_usage_count(new.template_id) > 0 then
    raise exception 'هذا النموذج مستعمَل في زيارات — أنشئ نسخة جديدة بدل تغيير مفتاح الحقل أو نوعه';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_used_template_field on exam_template_fields;
create trigger trg_guard_used_template_field
  before update on exam_template_fields
  for each row execute function app_guard_used_template_field();

-- ---------------------------------------------------------------------------
-- 6) الصلاحيات و RLS
-- ---------------------------------------------------------------------------
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('exam_templates.view',   'عرض نماذج الفحص',   'exam_templates', 890),
  ('exam_templates.manage', 'إدارة نماذج الفحص', 'exam_templates', 892)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('branch_manager', 'exam_templates.view'), ('branch_manager', 'exam_templates.manage'),
  ('doctor',         'exam_templates.view'), ('doctor', 'exam_templates.manage'),
  ('nurse',          'exam_templates.view'),
  ('receptionist',   'exam_templates.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

do $$
declare t text;
begin
  foreach t in array array['exam_template_sections','exam_template_fields','exam_field_options']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format($p$create policy %I on %I for select to authenticated
                     using (app_is_member(organization_id))$p$, t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format($p$create policy %I on %I for all to authenticated
                     using (app_has_permission(organization_id, 'exam_templates.manage'))
                     with check (app_has_permission(organization_id, 'exam_templates.manage'))$p$,
                   t || '_write', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

drop policy if exists clinic_exam_templates_all_members on clinic_exam_templates;
drop policy if exists exam_templates_select on clinic_exam_templates;
create policy exam_templates_select on clinic_exam_templates for select to authenticated
  using (app_is_member(organization_id));
drop policy if exists exam_templates_write on clinic_exam_templates;
create policy exam_templates_write on clinic_exam_templates for all to authenticated
  using (app_has_permission(organization_id, 'exam_templates.manage'))
  with check (app_has_permission(organization_id, 'exam_templates.manage'));

revoke all on function app_rebuild_exam_schema(uuid) from public, anon;
revoke all on function app_template_usage_count(uuid) from public, anon;
revoke all on function app_clone_exam_template(uuid, text) from public, anon;
grant execute on function app_rebuild_exam_schema(uuid) to authenticated;
grant execute on function app_template_usage_count(uuid) to authenticated;
grant execute on function app_clone_exam_template(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) المنظور
-- ---------------------------------------------------------------------------
create or replace view v_exam_templates as
select
  t.id,
  t.organization_id,
  t.name_ar,
  t.name_en,
  t.specialty_code,
  t.specialty_value_id,
  sp.name_ar          as specialty_name,
  t.clinic_id,
  c.name              as clinic_name,
  t.canvas_type,
  t.version,
  t.parent_template_id,
  t.effective_from,
  t.effective_to,
  t.is_disabled,
  (select count(*) from exam_template_sections s where s.template_id = t.id) as section_count,
  (select count(*) from exam_template_fields f where f.template_id = t.id and f.is_active) as field_count,
  app_template_usage_count(t.id) as usage_count,
  t.created_at,
  t.updated_at
from clinic_exam_templates t
left join lookup_values sp on sp.id = t.specialty_value_id
left join clinics c on c.id = t.clinic_id;

alter view v_exam_templates set (security_invoker = on);
revoke all on v_exam_templates from anon;
grant select on v_exam_templates to authenticated;

commit;
