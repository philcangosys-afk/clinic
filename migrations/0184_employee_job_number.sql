-- ============================================================================
-- 0184 — الرقم الوظيفي يتولّد تلقائيًا: رمز المنشأة ورقمٌ متسلسل
-- ============================================================================
--
-- كان `employees.job_number` حقلًا نصيًّا يكتبه المستخدم بيده: يُترك فارغًا
-- غالبًا، ويُكرَّر أحيانًا، ولا يصلح مرجعًا في كشف رواتب ولا في بطاقة موظّف.
--
-- الآن: `ASN-1001` ثمّ `ASN-1002`… — ثلاثة أحرفٍ ترمز للمنشأة ورقمٌ متسلسل
-- يبدأ من 1001. والرمز في `organizations.employee_code_prefix` يضبطه المالك
-- من إعدادات المنشأة، فلا يُدفن في الشيفرة ولا يتشابه فرعان لمالكٍ واحد.
--
-- **التسلسل في جدولٍ لا `max()+1`:** قراءة الأعلى ثمّ الزيادة تُعطي موظّفَين
-- الرقم نفسه إذا حُفظا في اللحظة ذاتها. الصفّ يُقفل بـ`update … returning`
-- فينتظر الثاني الأوّل.
--
-- **ما كُتب يدويًّا يبقى:** إن أدخل المستخدم رقمًا بنفسه احتُرم. والتوليد
-- لمن تُرك رقمه فارغًا وحده — فأرقام الموظفين القدامى لا تتبدّل تحت أيديهم.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

alter table organizations
  add column if not exists employee_code_prefix text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_employee_code_prefix_check') then
    alter table organizations add constraint organizations_employee_code_prefix_check
      check (employee_code_prefix is null or employee_code_prefix ~ '^[A-Z]{2,4}$');
  end if;
end $$;

comment on column organizations.employee_code_prefix is
  'بادئة الرقم الوظيفي: حرفان إلى أربعة لاتينية كبيرة ترمز للمنشأة (ASN). الفارغ يُعامَل EMP.';

-- بريد الموظّف: حساب الدخول في Supabase Auth، وهنا نسخةٌ للعرض والبحث
alter table employees
  add column if not exists email text;

create table if not exists employee_number_sequences (
  organization_id uuid primary key references organizations(id) on delete cascade,
  next_number     integer not null default 1001,
  updated_at      timestamptz not null default now()
);

alter table employee_number_sequences enable row level security;
revoke all on employee_number_sequences from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- التسلسل: صفٌّ يُقفل، فلا رقمان متطابقان
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_next_employee_job_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_number integer;
begin
  select coalesce(nullif(trim(coalesce(employee_code_prefix, '')), ''), 'EMP')
    into v_prefix from organizations where id = p_organization_id;
  if v_prefix is null then
    raise exception 'المنشأة غير موجودة';
  end if;

  -- أوّل تشغيل: التسلسل يبدأ بعد أعلى رقمٍ قائمٍ بهذه البادئة، فلا يصطدم
  -- الجديد بما أُدخل يدويًّا قبل هذه الترقية.
  insert into employee_number_sequences (organization_id, next_number)
  select p_organization_id,
         greatest(
           1001,
           coalesce((
             select max(nullif(regexp_replace(job_number, '\D', '', 'g'), '')::bigint)
               from employees
              where organization_id = p_organization_id
                and job_number is not null
                and regexp_replace(job_number, '\D', '', 'g') <> ''
           ), 0)::int + 1)
  on conflict (organization_id) do nothing;

  update employee_number_sequences
     set next_number = next_number + 1,
         updated_at  = now()
   where organization_id = p_organization_id
  returning next_number - 1 into v_number;

  return v_prefix || '-' || v_number::text;
end $$;

revoke all on function app_next_employee_job_number(uuid) from public, anon;
grant execute on function app_next_employee_job_number(uuid) to authenticated;

create or replace function app_fill_employee_job_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(trim(coalesce(new.job_number, '')), '') = '' then
    new.job_number := app_next_employee_job_number(new.organization_id);
  end if;
  return new;
end $$;

revoke all on function app_fill_employee_job_number() from public, anon, authenticated;

drop trigger if exists trg_fill_employee_job_number on employees;
create trigger trg_fill_employee_job_number
  before insert on employees
  for each row execute function app_fill_employee_job_number();

-- ═══════════════════════════════════════════════════════════════════════════
-- لا رقمان متطابقان في منشأة — ويُتخطّى الفهرس إن كان في البيانات تكرارٌ قديم
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_dup int;
begin
  select count(*) into v_dup from (
    select organization_id, job_number
      from employees
     where coalesce(trim(coalesce(job_number, '')), '') <> ''
     group by organization_id, job_number
    having count(*) > 1
  ) t;
  if v_dup > 0 then
    raise notice '0184: % رقمًا وظيفيًّا مكرَّرًا في البيانات — لم يُنشأ فهرس التفرّد', v_dup;
  else
    create unique index if not exists uq_employees_job_number
      on employees (organization_id, job_number)
      where job_number is not null and job_number <> '';
  end if;
end $$;

commit;
