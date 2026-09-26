-- ============================================================================
-- 0188 — أرشفة ملفّ الموظّف، وحذفه نهائيًّا حين لا يتعلّق به شيء
-- ============================================================================
--
-- شاشة الموظفين كانت تُنشئ وتُعدّل ولا تُزيل. فمن أُدخل بالخطأ يبقى في
-- القائمة إلى الأبد، ومن تركَ العمل يظلّ ظاهرًا كأنّه على رأس عمله.
--
-- ── لماذا بابان لا باب واحد ───────────────────────────────────────────────
--
-- **الأرشفة** هي الباب الصحيح لمن عمل فعلًا: راتبه مصروف، وحضوره مسجَّل،
-- وتوقيعه على تقارير. حذفُه يكسر قيودًا محاسبيّة ويُفقد أثرًا لا يجوز فقده.
-- فتُرفع عنه الظهور في القوائم، ويُقطع دخوله، ويبقى سجلّه كما هو.
--
-- **الحذف النهائيّ** بابٌ لحالةٍ واحدة: ملفٌّ أُدخل بالخطأ ولم يتعلّق به شيء.
-- والدالّة لا تأخذ كلمتي على ذلك: تسأل `pg_constraint` عن كلّ جدولٍ يشير إلى
-- `employees`، وتعدّ صفوفه. فإن وُجد صفٌّ واحدٌ في أيّ جدولٍ سوى ما هو جزءٌ من
-- الملفّ نفسه (وثائقه وتاريخ مناصبه) رفضت الحذف **وسمَّت الجدول** — فيعلم
-- الطالب أنّ أمامه أرشفةً لا حذفًا، ويعلم لماذا.
--
-- الفحص بالاستدلال على القيود لا بقائمةٍ مكتوبة: كلّ جدولٍ يُضاف بعد اليوم
-- ويشير إلى الموظّف يصير محميًّا من تلقاء نفسه، بلا تعديل هنا.
--
-- ── الدخول يُقطع مع الأرشفة ────────────────────────────────────────────────
-- ملفٌّ مؤرشف وحسابٌ يفتح النظام معًا = موظّفٌ تركَ العمل ولا يزال يدخل.
-- فالأرشفة تُعطّل عضويّته أيضًا في نفس المعاملة. والحساب في `auth` لا يُحذف:
-- حذفه يُفقد نسبة ما فعله إليه في سجلّ التدقيق.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ── 1) أعمدة الأرشفة ───────────────────────────────────────────────────────

alter table employees
  add column if not exists is_archived    boolean not null default false,
  add column if not exists archived_at    timestamptz,
  add column if not exists archived_by    uuid references auth.users(id),
  add column if not exists archive_reason text;

comment on column employees.is_archived is
  'ملفّ مؤرشف — لا يظهر في القوائم ولا في قوائم الاختيار، وسجلّه محفوظ.';

create index if not exists idx_employees_active_not_archived
  on employees (organization_id)
  where is_archived = false;

-- ── 2) الأرشفة والاستعادة ──────────────────────────────────────────────────

create or replace function app_archive_employee(
  p_employee_id uuid,
  p_reason      text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_name text;
  v_uid  uuid;
begin
  select organization_id, name_ar, user_id
    into v_org, v_name, v_uid
    from employees
   where id = p_employee_id;

  if v_org is null then
    raise exception 'ملفّ الموظّف غير موجود';
  end if;
  if not app_has_permission(v_org, 'hr.manage') then
    raise exception 'صلاحيتك لا تسمح بأرشفة ملفّات الموظفين';
  end if;

  update employees
     set is_archived    = true,
         archived_at    = now(),
         archived_by    = auth.uid(),
         archive_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         -- «منتهي» لا «نشط»: التقارير تقرأ `status` لا `is_archived`
         status         = 'terminated'
   where id = p_employee_id;

  -- الدخول يُقطع مع الأرشفة — عضويّة معطّلة لا محذوفة
  if v_uid is not null then
    update organization_memberships
       set is_active = false
     where organization_id = v_org
       and user_id = v_uid
       and is_active;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, auth.uid(), 'hr', 'update', p_employee_id,
          'أرشفة ملفّ موظّف: ' || coalesce(v_name, '—'),
          nullif(btrim(coalesce(p_reason, '')), ''));

  return true;
end $$;

create or replace function app_restore_employee(p_employee_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_name text;
begin
  select organization_id, name_ar into v_org, v_name
    from employees where id = p_employee_id;

  if v_org is null then
    raise exception 'ملفّ الموظّف غير موجود';
  end if;
  if not app_has_permission(v_org, 'hr.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة ملفّات الموظفين';
  end if;

  -- الاستعادة تُعيد الملفّ للقوائم ولا تُعيد الدخول: العضويّة تُفعَّل من
  -- «المستخدمون والصلاحيات» بقرارٍ مستقلّ، لأنّ إعادة فتح النظام لأحدٍ
  -- ليست نتيجةً تلقائيّة لإعادة ملفّه.
  update employees
     set is_archived    = false,
         archived_at    = null,
         archived_by    = null,
         archive_reason = null,
         status         = case when termination_date is null then 'active' else status end
   where id = p_employee_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, auth.uid(), 'hr', 'update', p_employee_id,
          'استعادة ملفّ موظّف: ' || coalesce(v_name, '—'), null);

  return true;
end $$;

-- ── 3) ما يتعلّق بالموظّف — استدلالًا على القيود لا بقائمةٍ مكتوبة ─────────
--
-- تُرجع صفًّا لكلّ جدولٍ يشير إلى `employees(id)` وفيه صفوفٌ لهذا الموظّف.
-- `employee_documents` و`employee_position_history` جزءٌ من الملفّ نفسه فلا
-- تَعُدّان مانعًا — وتُحذفان معه.

create or replace function app_employee_dependencies(p_employee_id uuid)
returns table (table_name text, column_name text, row_count bigint, blocking boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_rec record;
  v_n   bigint;
begin
  select organization_id into v_org from employees where id = p_employee_id;
  if v_org is null then
    raise exception 'ملفّ الموظّف غير موجود';
  end if;
  if not app_has_permission(v_org, 'hr.view') then
    raise exception 'صلاحيتك لا تسمح بعرض ملفّات الموظفين';
  end if;

  for v_rec in
    -- (أ) ما يشير إلى الموظّف بقيدٍ صريح
    select cl.relname::text  as tbl,
           att.attname::text as col
      from pg_constraint c
      join pg_class      cl  on cl.oid = c.conrelid
      join pg_namespace  ns  on ns.oid = cl.relnamespace
      join pg_class      rcl on rcl.oid = c.confrelid
      join unnest(c.conkey) with ordinality as k(attnum, ord) on true
      join pg_attribute  att on att.attrelid = c.conrelid and att.attnum = k.attnum
     where c.contype = 'f'
       and rcl.relname = 'employees'
       and ns.nspname = 'public'
       and array_length(c.conkey, 1) = 1
    union
    -- (ب) ما يشير إليه بعمودٍ باسمه بلا قيد.
    --
    -- **ليس احتياطًا نظريًّا:** قيدٌ ناقص يعني أنّ الفحص بـ `pg_constraint`
    -- وحده يرى الجدول نظيفًا فيمضي الحذف ويترك صفوفًا معلّقة بلا أبٍ — وهو
    -- أسوأ من رفضٍ زائد. فيُضاف كلّ عمودٍ من نوع uuid اسمه ينتهي بـ
    -- `employee_id`، فيُحسب الجدول حتى إن غاب قيده.
    select cl.relname::text  as tbl,
           att.attname::text as col
      from pg_class     cl
      join pg_namespace ns  on ns.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = cl.oid
     where cl.relkind = 'r'
       and ns.nspname = 'public'
       and cl.relname <> 'employees'
       and att.attnum > 0
       and not att.attisdropped
       and att.atttypid = 'uuid'::regtype
       and att.attname like '%employee_id'
  loop
    execute format('select count(*) from %I where %I = $1', v_rec.tbl, v_rec.col)
       into v_n using p_employee_id;
    if v_n > 0 then
      table_name  := v_rec.tbl;
      column_name := v_rec.col;
      row_count   := v_n;
      blocking    := v_rec.tbl not in ('employee_documents', 'employee_position_history');
      return next;
    end if;
  end loop;
end $$;

-- ── 4) الحذف النهائيّ — لمن لم يتعلّق به شيء ───────────────────────────────

create or replace function app_delete_employee(p_employee_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_name    text;
  v_uid     uuid;
  v_blocked text;
  v_rec     record;
begin
  select organization_id, name_ar, user_id
    into v_org, v_name, v_uid
    from employees
   where id = p_employee_id;

  if v_org is null then
    raise exception 'ملفّ الموظّف غير موجود';
  end if;
  if not app_has_permission(v_org, 'hr.manage') then
    raise exception 'صلاحيتك لا تسمح بحذف ملفّات الموظفين';
  end if;

  -- أوّلًا: هل يتعلّق به شيء؟ الرسالة تُسمّي الجداول لا تقول «لا يمكن».
  select string_agg(d.table_name || ' (' || d.row_count || ')', '، ' order by d.table_name)
    into v_blocked
    from app_employee_dependencies(p_employee_id) d
   where d.blocking;

  if v_blocked is not null then
    raise exception
      'لا يُحذف هذا الملفّ نهائيًّا: يتعلّق به سجلّاتٌ في %. استخدم الأرشفة — تُخفيه من القوائم وتقطع دخوله وتُبقي سجلّه.',
      v_blocked;
  end if;

  -- الحساب لا يُحذف من `auth` — تُقطع عضويّته فقط، ويبقى أثره في التدقيق
  if v_uid is not null then
    update organization_memberships
       set is_active = false
     where organization_id = v_org
       and user_id = v_uid
       and is_active;
  end if;

  -- ما هو جزءٌ من الملفّ يُحذف معه صراحةً: قيود `on delete cascade` قد تكون
  -- كذلك، لكن الصريح هنا يجعل ما يُحذف مقروءًا لا مُستنتَجًا.
  for v_rec in
    select d.table_name, d.column_name
      from app_employee_dependencies(p_employee_id) d
     where not d.blocking
  loop
    execute format('delete from %I where %I = $1', v_rec.table_name, v_rec.column_name)
      using p_employee_id;
  end loop;

  delete from employees where id = p_employee_id;

  insert into audit_log (organization_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_org, auth.uid(), 'hr', 'delete', p_employee_id,
          'حذف نهائيّ لملفّ موظّف: ' || coalesce(v_name, '—'),
          'لم يكن للملفّ أيّ سجلّ مالي أو تشغيليّ مرتبط');

  return true;
end $$;

-- ── 5) الصلاحيات ───────────────────────────────────────────────────────────

revoke all on function app_archive_employee(uuid, text)  from public, anon;
revoke all on function app_restore_employee(uuid)        from public, anon;
revoke all on function app_employee_dependencies(uuid)   from public, anon;
revoke all on function app_delete_employee(uuid)         from public, anon;

grant execute on function app_archive_employee(uuid, text)  to authenticated;
grant execute on function app_restore_employee(uuid)        to authenticated;
grant execute on function app_employee_dependencies(uuid)   to authenticated;
grant execute on function app_delete_employee(uuid)         to authenticated;

commit;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  select string_agg(f, '، ')
    into v_missing
    from unnest(array['app_archive_employee','app_restore_employee',
                      'app_employee_dependencies','app_delete_employee']) f
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f);
  if v_missing is not null then
    raise exception 'دوالّ ناقصة: %', v_missing;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'employees'
       and column_name = 'is_archived')
  then
    raise exception 'employees.is_archived لم يُنشأ';
  end if;

  raise notice '0188 ✓ الأرشفة والحذف النهائيّ المحميّ جاهزان';
end $$;
