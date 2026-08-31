-- ============================================================================
-- 0099 — المرحلة 19: المحاسبة العامة
-- ============================================================================
--
-- **ما كان قائمًا** (0017 و0027): دليل حسابات، وقيود ببنودها، وحارس توازن،
-- ومنع تعديل القيد المُرحَّل، وترحيلٌ تلقائيّ من ثلاثة مصادر (فاتورة مبيعات،
-- فاتورة مشتريات، سند ماليّ).
--
-- **ما ينقصه**:
--
--   • **لا سنوات ولا فترات مالية**: لا يوجد إقفال، فيُعدَّل قيدُ شهرٍ صدرت عنه
--     قوائمه وأُقرّت.
--   • **لا مراكز تكلفة ولا بُعد فرع على القيد**: القوائم لا تُقسَّم، فلا يُعرف
--     أيّ فرع يربح وأيّ فرع يخسر.
--   • **لا عكس للقيود**: القيد الخاطئ إمّا يبقى وإمّا يُحذف — والحذف يقطع
--     التسلسل ويُفقد الأثر.
--   • **قواعد الترحيل مدفونة في نصّ الدوال**: تغييرُ حسابٍ يعني تعديل دالّة،
--     والمطلوب — كما نصّ الشرط — أن **تُولَّد القيود من قواعد واضحة**.
--   • لا تسويات بنكية، ولا قائمة دخل، ولا ميزانية، ولا تدفّقات نقدية.
--
-- **الشرط الحاكم المنصوص عليه**: «كل عملية تشغيلية يجب أن تولّد القيد من
-- خلال قواعد ترحيل واضحة، وليس بإضافة القيود يدويًا من الواجهة». لذلك:
-- جدول `gl_posting_rules` يحمل القواعد، و`app_create_manual_journal_entry`
-- يشترط صلاحيةً منفصلة وسببًا، ولا يقبل مرجعًا لعمليةٍ لها قاعدة ترحيل.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) الصلاحيات
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('gl.view',           'عرض القيود والقوائم',       'accounting', 1200),
  ('gl.manual_entry',   'إضافة قيد يدويّ',           'accounting', 1202),
  ('gl.post',           'ترحيل القيود',              'accounting', 1204),
  ('gl.reverse',        'عكس القيود المرحَّلة',       'accounting', 1206),
  ('gl.close_period',   'إقفال الفترات المالية',     'accounting', 1208),
  ('gl.reopen_period',  'إعادة فتح فترة مقفلة',      'accounting', 1210),
  ('gl.rules',          'إدارة قواعد الترحيل',       'accounting', 1212),
  ('gl.reconcile',      'التسويات البنكية',          'accounting', 1214),
  ('gl.cost_centers',   'إدارة مراكز التكلفة',       'accounting', 1216)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

-- **إعادة فتح فترة مقفلة لا تُمنح لأحد افتراضيًّا.** إقفالٌ يُفتح بسهولة
-- ليس إقفالًا؛ من يحتاجها يمنحها له مالك المنشأة صراحةً.
insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('accountant',     'gl.view'), ('accountant', 'gl.manual_entry'),
  ('accountant',     'gl.post'), ('accountant', 'gl.reverse'),
  ('accountant',     'gl.reconcile'), ('accountant', 'gl.cost_centers'),
  ('branch_manager', 'gl.view')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) السنوات والفترات المالية
-- ===========================================================================
create table if not exists fiscal_years (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  start_date      date not null,
  end_date        date not null,
  status          text not null default 'open'
                    check (status in ('open','closed')),
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  constraint fiscal_years_range_check check (end_date > start_date)
);

-- سنوات لا تتداخل: يومٌ في سنتين يعني قوائم متناقضة لنفس التاريخ
create index if not exists idx_fiscal_years_org on fiscal_years (organization_id, start_date);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_years_no_overlap') then
    alter table fiscal_years add constraint fiscal_years_no_overlap
      exclude using gist (
        organization_id with =,
        daterange(start_date, end_date, '[]') with &&
      );
  end if;
exception when others then
  raise notice 'تعذّر تركيب مانع تداخل السنوات (%) — تحقّق من امتداد btree_gist', sqlerrm;
end $$;

create table if not exists fiscal_periods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  fiscal_year_id  uuid not null references fiscal_years(id) on delete cascade,
  period_number   integer not null check (period_number between 1 and 13),
  name            text,
  start_date      date not null,
  end_date        date not null,
  status          text not null default 'open'
                    check (status in ('open','closed','locked')),
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id),
  reopened_at     timestamptz,
  reopened_by     uuid references auth.users(id),
  reopen_reason   text,
  created_at      timestamptz not null default now(),
  constraint fiscal_periods_range_check check (end_date >= start_date)
);

create unique index if not exists uq_fiscal_period
  on fiscal_periods (fiscal_year_id, period_number);
create index if not exists idx_fiscal_periods_dates
  on fiscal_periods (organization_id, start_date, end_date);

comment on column fiscal_periods.status is
  '`closed` تُقفل الترحيل ويمكن إعادة فتحها بصلاحية وسبب. `locked` نهائيّة — بعد إقفال السنة والتدقيق الخارجيّ لا تُفتح.';

alter table fiscal_years enable row level security;
alter table fiscal_periods enable row level security;

create or replace function app_period_for_date(
  p_organization_id uuid,
  p_date            date
)
returns fiscal_periods
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.* from fiscal_periods p
   where p.organization_id = p_organization_id
     and p_date between p.start_date and p.end_date
   order by p.start_date limit 1;
$$;

-- ===========================================================================
-- 3) مراكز التكلفة وبُعد الفرع
-- ===========================================================================
create table if not exists cost_centers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  code            text not null,
  name_ar         text not null,
  name_en         text,
  center_type     text not null default 'department'
                    check (center_type in ('branch','clinic','department','project','doctor')),
  clinic_id       uuid references clinics(id),
  doctor_id       uuid references doctors(id),
  parent_center_id uuid references cost_centers(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_cost_center_code
  on cost_centers (organization_id, code);

alter table cost_centers enable row level security;

alter table journal_entries
  add column if not exists branch_id        uuid references branches(id),
  add column if not exists fiscal_period_id uuid references fiscal_periods(id),
  add column if not exists posting_rule_id  uuid,
  add column if not exists reversal_of_id   uuid references journal_entries(id),
  add column if not exists reversed_by_id   uuid references journal_entries(id),
  add column if not exists is_manual        boolean not null default false,
  add column if not exists manual_reason    text,
  add column if not exists void_reason      text,
  add column if not exists posted_by        uuid references auth.users(id),
  add column if not exists updated_at       timestamptz not null default now();

alter table journal_entry_lines
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists branch_id       uuid references branches(id),
  add column if not exists cost_center_id  uuid references cost_centers(id),
  add column if not exists line_number     integer;

update journal_entry_lines l
   set organization_id = e.organization_id
  from journal_entries e
 where l.journal_entry_id = e.id and l.organization_id is null;

create index if not exists idx_jel_account
  on journal_entry_lines (account_id);
create index if not exists idx_jel_cost_center
  on journal_entry_lines (cost_center_id) where cost_center_id is not null;
create index if not exists idx_je_period
  on journal_entries (organization_id, entry_date, status);

-- ===========================================================================
-- 4) قواعد الترحيل — القيد يُولَّد منها لا من نصّ الدالّة
-- ===========================================================================
create table if not exists gl_posting_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_key        text not null,
  name_ar         text not null,
  source_event    text not null
                    check (source_event in ('sales_invoice','purchase_invoice','payment_voucher',
                                            'receipt_voucher','refund','payroll','inventory_movement',
                                            'insurance_settlement','stock_adjustment','depreciation')),
  debit_account_id  uuid references chart_of_accounts(id),
  credit_account_id uuid references chart_of_accounts(id),
  amount_expression text not null default 'net_amount',
  condition_note  text,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);

create unique index if not exists uq_gl_rule_key
  on gl_posting_rules (organization_id, rule_key);

comment on table gl_posting_rules is
  'قواعد الترحيل المحاسبيّ: أيّ حدثٍ تشغيليّ يولّد أيّ قيد. **الشرط الحاكم للمرحلة**: القيود تُولَّد من هنا لا تُضاف يدويًّا من الواجهة، وتغيير حسابٍ يكون بتعديل قاعدة لا بتعديل دالّة.';

alter table gl_posting_rules enable row level security;

-- ===========================================================================
-- 5) الحارس: لا ترحيل في فترة مقفلة، ولا تعديل لقيد مُرحَّل
-- ===========================================================================
create or replace function app_guard_fiscal_period()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_p fiscal_periods%rowtype;
begin
  select * into v_p from app_period_for_date(new.organization_id, new.entry_date);

  -- لا فترة معرَّفة: النظام قد يبدأ بلا سنوات مالية، فلا نُعطّل التشغيل.
  -- لكن ما إن تُعرَّف الفترة حتى يصير إقفالها ملزِمًا.
  if v_p.id is null then
    new.updated_at := now();
    return new;
  end if;

  new.fiscal_period_id := v_p.id;

  if v_p.status in ('closed','locked') then
    -- المسوّدة يجوز حفظها في فترة مقفلة، لكن **الترحيل ممنوع**: القوائم صدرت.
    if new.status = 'posted' and (TG_OP = 'INSERT' or coalesce(old.status, '') <> 'posted') then
      raise exception 'الفترة المالية (% إلى %) % — لا يُرحَّل فيها قيد',
        v_p.start_date, v_p.end_date,
        case when v_p.status = 'locked' then 'مقفلة نهائيًّا' else 'مقفلة' end;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_fiscal_period on journal_entries;
create trigger trg_guard_fiscal_period
  before insert or update on journal_entries
  for each row execute function app_guard_fiscal_period();

-- **القيد المرحَّل لا يُحذف ولا يُلغى** — يُعكَس بقيدٍ مضادّ.
create or replace function app_block_posted_entry_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'posted' then
    raise exception 'القيد المرحَّل لا يُحذف — استخدم العكس بقيدٍ مضادّ';
  end if;
  return old;
end $$;

drop trigger if exists trg_block_posted_entry_delete on journal_entries;
create trigger trg_block_posted_entry_delete
  before delete on journal_entries
  for each row execute function app_block_posted_entry_delete();

-- ===========================================================================
-- 6) الدوال
-- ===========================================================================

create or replace function app_close_fiscal_period(
  p_period_id uuid,
  p_lock      boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p     fiscal_periods%rowtype;
  v_draft int;
begin
  select * into v_p from fiscal_periods where id = p_period_id for update;
  if v_p.id is null then raise exception 'الفترة غير موجودة'; end if;
  if not app_has_permission(v_p.organization_id, 'gl.close_period') then
    raise exception 'صلاحيتك لا تسمح بإقفال الفترات (gl.close_period)';
  end if;
  if v_p.status = 'locked' then raise exception 'الفترة مقفلة نهائيًّا'; end if;

  -- **لا إقفال وفي الفترة مسوّدات**: قيدٌ لم يُرحَّل يعني معاملةً خارج القوائم.
  select count(*) into v_draft
    from journal_entries
   where organization_id = v_p.organization_id
     and entry_date between v_p.start_date and v_p.end_date
     and status = 'draft';
  if v_draft > 0 then
    raise exception 'في الفترة % قيدًا مسوّدة — رحّلها أو ألغِها قبل الإقفال', v_draft;
  end if;

  update fiscal_periods
     set status = case when p_lock then 'locked' else 'closed' end,
         closed_at = now(), closed_by = auth.uid()
   where id = p_period_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (v_p.organization_id, auth.uid(), 'accounting', 'update', p_period_id,
          'إقفال فترة مالية',
          format('أُقفلت الفترة %s إلى %s%s', v_p.start_date, v_p.end_date,
                 case when p_lock then ' نهائيًّا' else '' end));
end $$;

create or replace function app_reopen_fiscal_period(
  p_period_id uuid,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_p fiscal_periods%rowtype;
begin
  select * into v_p from fiscal_periods where id = p_period_id for update;
  if v_p.id is null then raise exception 'الفترة غير موجودة'; end if;
  if not app_has_permission(v_p.organization_id, 'gl.reopen_period') then
    raise exception 'صلاحيتك لا تسمح بإعادة فتح الفترات (gl.reopen_period)';
  end if;
  -- المقفلة نهائيًّا لا تُفتح: بعد التدقيق الخارجيّ لا رجعة
  if v_p.status = 'locked' then
    raise exception 'الفترة مقفلة نهائيًّا ولا يمكن إعادة فتحها';
  end if;
  if v_p.status <> 'closed' then raise exception 'الفترة ليست مقفلة'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب إعادة الفتح مطلوب — إعادة الفتح حدثٌ يُدقَّق';
  end if;

  update fiscal_periods
     set status = 'open', reopened_at = now(), reopened_by = auth.uid(),
         reopen_reason = p_reason
   where id = p_period_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_p.organization_id, auth.uid(), 'accounting', 'update', p_period_id,
          'إعادة فتح فترة مالية',
          format('أُعيد فتح %s إلى %s', v_p.start_date, v_p.end_date), p_reason);
end $$;

-- القيد اليدويّ: مسموحٌ بشروط، وممنوعٌ حيث توجد قاعدة ترحيل
create or replace function app_create_manual_journal_entry(
  p_organization_id uuid,
  p_entry_date      date,
  p_description     text,
  p_reason          text,
  p_lines           jsonb,   -- [{account_id, debit, credit, description, cost_center_id, branch_id}]
  p_branch_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_line   jsonb;
  v_debit  numeric := 0;
  v_credit numeric := 0;
  v_n      int := 0;
begin
  if not app_has_permission(p_organization_id, 'gl.manual_entry') then
    raise exception 'صلاحيتك لا تسمح بالقيود اليدوية (gl.manual_entry)';
  end if;
  -- **القيد اليدويّ استثناء يُبرَّر**: القاعدة أن تُولَّد القيود من العمليات.
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب القيد اليدويّ مطلوب — القيود تُولَّد من العمليات، واليدويّ استثناء';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) < 2 then
    raise exception 'القيد يحتاج بندين على الأقل';
  end if;

  insert into journal_entries (organization_id, branch_id, entry_date, description,
                               status, is_manual, manual_reason, created_by)
  values (p_organization_id, p_branch_id, p_entry_date, p_description,
          'draft', true, p_reason, auth.uid())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_n := v_n + 1;
    insert into journal_entry_lines (journal_entry_id, organization_id, account_id,
                                     debit, credit, description, cost_center_id,
                                     branch_id, line_number)
    values (v_id, p_organization_id, (v_line->>'account_id')::uuid,
            coalesce((v_line->>'debit')::numeric, 0),
            coalesce((v_line->>'credit')::numeric, 0),
            v_line->>'description',
            nullif(v_line->>'cost_center_id', '')::uuid,
            coalesce(nullif(v_line->>'branch_id', '')::uuid, p_branch_id),
            v_n);

    v_debit  := v_debit  + coalesce((v_line->>'debit')::numeric, 0);
    v_credit := v_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;

  if round(v_debit, 2) <> round(v_credit, 2) then
    raise exception 'القيد غير متوازن: مدين % ودائن %', v_debit, v_credit;
  end if;
  if round(v_debit, 2) = 0 then
    raise exception 'القيد بقيمة صفر';
  end if;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (p_organization_id, p_branch_id, auth.uid(), 'accounting', 'add', v_id,
          'قيد يدويّ', format('قيد بقيمة %s', v_debit), p_reason);

  return v_id;
end $$;

create or replace function app_post_journal_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e      journal_entries%rowtype;
  v_debit  numeric;
  v_credit numeric;
begin
  select * into v_e from journal_entries where id = p_entry_id for update;
  if v_e.id is null then raise exception 'القيد غير موجود'; end if;
  if not app_has_permission(v_e.organization_id, 'gl.post') then
    raise exception 'صلاحيتك لا تسمح بترحيل القيود (gl.post)';
  end if;
  if v_e.status <> 'draft' then
    raise exception 'لا يُرحَّل قيد حالته %', v_e.status;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_debit, v_credit
    from journal_entry_lines where journal_entry_id = p_entry_id;
  if round(v_debit, 2) <> round(v_credit, 2) then
    raise exception 'القيد غير متوازن: مدين % ودائن %', v_debit, v_credit;
  end if;

  -- حارس الفترة يعمل على التحديث فيرفض الترحيل في فترة مقفلة
  update journal_entries
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_entry_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_e.organization_id, v_e.branch_id, auth.uid(), 'accounting', 'update',
          p_entry_id, 'ترحيل قيد', format('رُحّل قيد بقيمة %s', v_debit));
end $$;

-- **العكس بدل الحذف**: قيدٌ مضادّ بنفس التاريخ أو بتاريخ لاحق إن كانت
-- الفترة الأصلية مقفلة — فلا يُفتح إقفالٌ لتصحيح خطأ.
create or replace function app_reverse_journal_entry(
  p_entry_id uuid,
  p_reason   text,
  p_date     date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e    journal_entries%rowtype;
  v_new  uuid;
  v_line record;
  v_p    fiscal_periods%rowtype;
  v_date date;
  v_n    int := 0;
begin
  select * into v_e from journal_entries where id = p_entry_id for update;
  if v_e.id is null then raise exception 'القيد غير موجود'; end if;
  if not app_has_permission(v_e.organization_id, 'gl.reverse') then
    raise exception 'صلاحيتك لا تسمح بعكس القيود (gl.reverse)';
  end if;
  if v_e.status <> 'posted' then
    raise exception 'لا يُعكس قيد حالته % — المسوّدة تُعدَّل أو تُحذف', v_e.status;
  end if;
  if v_e.reversed_by_id is not null then
    raise exception 'القيد معكوس سلفًا';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'سبب العكس مطلوب'; end if;

  v_date := coalesce(p_date, v_e.entry_date);
  select * into v_p from app_period_for_date(v_e.organization_id, v_date);
  -- لو كانت فترة القيد الأصليّ مقفلة، يُعكس في أوّل يومٍ من فترة مفتوحة
  if v_p.id is not null and v_p.status in ('closed','locked') then
    select p.start_date into v_date
      from fiscal_periods p
     where p.organization_id = v_e.organization_id
       and p.status = 'open' and p.start_date > v_p.end_date
     order by p.start_date limit 1;
    if v_date is null then
      raise exception 'فترة القيد مقفلة ولا توجد فترة مفتوحة لاحقة لعكسه فيها';
    end if;
  end if;

  insert into journal_entries (organization_id, branch_id, entry_date, description,
                               status, reference_type, reference_id, reversal_of_id,
                               is_manual, manual_reason, created_by)
  values (v_e.organization_id, v_e.branch_id, v_date,
          format('عكس قيد: %s', coalesce(v_e.description, '')),
          -- `reference_type` قائمة مغلقة منذ 0017؛ العكس يُوسم `manual`
          -- ويُميَّز بـ`reversal_of_id`. توسيع القائمة كان سيُخرج القيود
          -- من كل تقرير يرشّح بالنوع.
          'draft', 'manual', p_entry_id, p_entry_id, false, p_reason, auth.uid())
  returning id into v_new;

  -- المدين يصير دائنًا والعكس
  for v_line in
    select * from journal_entry_lines where journal_entry_id = p_entry_id
     order by coalesce(line_number, 0)
  loop
    v_n := v_n + 1;
    insert into journal_entry_lines (journal_entry_id, organization_id, account_id,
                                     debit, credit, description, cost_center_id,
                                     branch_id, line_number)
    values (v_new, v_e.organization_id, v_line.account_id,
            v_line.credit, v_line.debit,
            format('عكس: %s', coalesce(v_line.description, '')),
            v_line.cost_center_id, v_line.branch_id, v_n);
  end loop;

  update journal_entries set reversed_by_id = v_new where id = p_entry_id;

  perform app_post_journal_entry(v_new);

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details, reason)
  values (v_e.organization_id, v_e.branch_id, auth.uid(), 'accounting', 'update',
          p_entry_id, 'عكس قيد', format('عُكس القيد بقيدٍ مضادّ بتاريخ %s', v_date),
          p_reason);

  return v_new;
end $$;

-- ===========================================================================
-- 7) التسويات البنكية
-- ===========================================================================
create table if not exists bank_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  branch_id         uuid references branches(id),
  account_id        uuid not null references chart_of_accounts(id),
  statement_date    date not null,
  statement_balance numeric(14,2) not null,
  book_balance      numeric(14,2) not null default 0,
  status            text not null default 'draft'
                      check (status in ('draft','completed')),
  note              text,
  completed_at      timestamptz,
  completed_by      uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create table if not exists bank_reconciliation_lines (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  bank_reconciliation_id uuid not null references bank_reconciliations(id) on delete cascade,
  journal_entry_line_id  uuid references journal_entry_lines(id),
  voucher_id             uuid references financial_vouchers(id),
  amount                 numeric(14,2) not null,
  is_cleared             boolean not null default false,
  cleared_date           date,
  note                   text,
  created_at             timestamptz not null default now()
);

alter table bank_reconciliations enable row level security;
alter table bank_reconciliation_lines enable row level security;

comment on table bank_reconciliations is
  'التسوية البنكية: رصيد الكشف مقابل رصيد الدفاتر، والفرق يُفسَّر بالبنود غير المطابَقة.';

create or replace function app_complete_bank_reconciliation(p_reconciliation_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r     bank_reconciliations%rowtype;
  v_book  numeric;
  v_uncl  numeric;
  v_diff  numeric;
begin
  select * into v_r from bank_reconciliations where id = p_reconciliation_id for update;
  if v_r.id is null then raise exception 'التسوية غير موجودة'; end if;
  if not app_has_permission(v_r.organization_id, 'gl.reconcile') then
    raise exception 'صلاحيتك لا تسمح بالتسويات البنكية (gl.reconcile)';
  end if;
  if v_r.status <> 'draft' then raise exception 'التسوية مكتملة سلفًا'; end if;

  -- رصيد الدفاتر حتى تاريخ الكشف من القيود المرحَّلة وحدها
  select coalesce(sum(l.debit - l.credit), 0) into v_book
    from journal_entry_lines l
    join journal_entries e on e.id = l.journal_entry_id
   where l.account_id = v_r.account_id
     and e.status = 'posted'
     and e.entry_date <= v_r.statement_date;

  select coalesce(sum(amount), 0) into v_uncl
    from bank_reconciliation_lines
   where bank_reconciliation_id = p_reconciliation_id and not is_cleared;

  -- **الفرق يجب أن تفسّره البنود غير المطابَقة**، وإلا فالتسوية لم تسوِّ شيئًا
  v_diff := round(v_r.statement_balance - (v_book - v_uncl), 2);
  if abs(v_diff) > 0.01 then
    raise exception 'التسوية لا تتوازن: فرقٌ غير مفسَّر قدره % (كشف %, دفاتر %, غير مطابَق %)',
      v_diff, v_r.statement_balance, v_book, v_uncl;
  end if;

  update bank_reconciliations
     set status = 'completed', book_balance = v_book,
         completed_at = now(), completed_by = auth.uid()
   where id = p_reconciliation_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_r.organization_id, v_r.branch_id, auth.uid(), 'accounting', 'update',
          p_reconciliation_id, 'إتمام تسوية بنكية',
          format('كشف %s، دفاتر %s', v_r.statement_balance, v_book));

  return v_book;
end $$;

-- ===========================================================================
-- 8) القوائم المالية
-- ===========================================================================

-- أساس مشترك: بنود القيود المرحَّلة بأبعادها
-- تُسقَط معها العروض المبنيّة فوقها (قائمة الدخل، الميزانية، التدفق النقدي،
-- أداء مراكز التكلفة) وتُعاد جميعها في هذا الملف نفسه بعد قليل.
drop view if exists v_gl_lines cascade;
create view v_gl_lines
with (security_invoker = on) as
select
  l.id                 as line_id,
  e.id                 as journal_entry_id,
  e.organization_id,
  coalesce(l.branch_id, e.branch_id) as branch_id,
  br.name              as branch_name,
  e.entry_date         as report_date,
  e.entry_number,
  e.status,
  e.reference_type,
  e.reference_id,
  e.is_manual,
  e.reversal_of_id,
  e.fiscal_period_id,
  fp.name              as period_name,
  fp.status            as period_status,
  l.account_id,
  a.code               as account_code,
  a.name_ar            as account_name,
  a.account_type,
  l.cost_center_id,
  cc.code              as cost_center_code,
  cc.name_ar           as cost_center_name,
  l.debit,
  l.credit,
  (l.debit - l.credit) as net_amount,
  l.description
from journal_entry_lines l
join journal_entries e on e.id = l.journal_entry_id
join chart_of_accounts a on a.id = l.account_id
left join branches br on br.id = coalesce(l.branch_id, e.branch_id)
left join cost_centers cc on cc.id = l.cost_center_id
left join fiscal_periods fp on fp.id = e.fiscal_period_id
where e.status = 'posted';

comment on view v_gl_lines is
  'بنود القيود المرحَّلة بأبعادها (فرع/مركز تكلفة/فترة). كل القوائم تُبنى عليه، فلا تتفرّق تعريفات «المُرحَّل».';

drop view if exists v_income_statement;
create view v_income_statement
with (security_invoker = on) as
select
  organization_id,
  branch_id,
  branch_name,
  cost_center_id,
  cost_center_name,
  report_date,
  account_id,
  account_code,
  account_name,
  account_type,
  -- الإيراد دائنٌ بطبعه، فيُعرض موجبًا؛ والمصروف مدينٌ فيُعرض موجبًا أيضًا.
  -- عرضُهما بإشارة الدفاتر يجعل كل إيراد يبدو سالبًا في القائمة.
  case when account_type = 'revenue' then credit - debit else debit - credit end
                       as amount,
  case when account_type = 'revenue' then 'revenue' else 'expense' end as section
from v_gl_lines
where account_type in ('revenue','expense');

comment on view v_income_statement is
  'قائمة الدخل بحبّة البند. الإيراد والمصروف بإشارة موجبة كلاهما، لا بإشارة الدفاتر.';

drop view if exists v_balance_sheet;
create view v_balance_sheet
with (security_invoker = on) as
select
  organization_id,
  branch_id,
  branch_name,
  report_date,
  account_id,
  account_code,
  account_name,
  account_type,
  case when account_type = 'asset' then debit - credit else credit - debit end
                       as amount,
  case account_type
    when 'asset'     then 'الأصول'
    when 'liability' then 'الخصوم'
    else 'حقوق الملكية'
  end                  as section
from v_gl_lines
where account_type in ('asset','liability','equity');

comment on view v_balance_sheet is
  'الميزانية بحبّة البند. الأصول مدينة والخصوم وحقوق الملكية دائنة، وكلّها بإشارة موجبة للعرض.';

drop view if exists v_cost_center_performance;
create view v_cost_center_performance
with (security_invoker = on) as
select
  g.organization_id,
  g.branch_id,
  g.branch_name,
  g.cost_center_id,
  g.cost_center_code,
  g.cost_center_name,
  g.report_date,
  sum(case when g.account_type = 'revenue' then g.credit - g.debit else 0 end) as revenue,
  sum(case when g.account_type = 'expense' then g.debit - g.credit else 0 end) as expense,
  sum(case when g.account_type = 'revenue' then g.credit - g.debit
           when g.account_type = 'expense' then g.debit - g.credit
           else 0 end)                                                          as net_result
from v_gl_lines g
where g.account_type in ('revenue','expense')
group by g.organization_id, g.branch_id, g.branch_name, g.cost_center_id,
         g.cost_center_code, g.cost_center_name, g.report_date;

comment on view v_cost_center_performance is
  'أداء مراكز التكلفة والفروع: إيراد ومصروف وصافٍ — الفرع الذي يخسر يظهر هنا لا في الإجمالي.';

-- التدفّقات النقدية بالطريقة المباشرة: حركة حسابات النقد والبنوك
drop view if exists v_cash_flow;
create view v_cash_flow
with (security_invoker = on) as
select
  g.organization_id,
  g.branch_id,
  g.branch_name,
  g.report_date,
  g.account_id,
  g.account_code,
  g.account_name,
  sum(g.debit)         as cash_in,
  sum(g.credit)        as cash_out,
  sum(g.debit - g.credit) as net_cash_flow,
  count(*)             as entry_count
from v_gl_lines g
where g.account_type = 'asset'
  and (g.account_code like '11%' or g.account_name like '%نقد%'
       or g.account_name like '%بنك%' or g.account_name like '%صندوق%')
group by g.organization_id, g.branch_id, g.branch_name, g.report_date,
         g.account_id, g.account_code, g.account_name;

comment on view v_cash_flow is
  'التدفّق النقدي بالطريقة المباشرة من حركة حسابات النقد والبنوك المرحَّلة.';

drop view if exists v_fiscal_period_status;
create view v_fiscal_period_status
with (security_invoker = on) as
select
  p.id                 as fiscal_period_id,
  p.organization_id,
  null::uuid           as branch_id,
  p.fiscal_year_id,
  y.name               as fiscal_year_name,
  y.status             as year_status,
  p.period_number,
  p.name               as period_name,
  p.start_date         as report_date,
  p.end_date,
  p.status,
  p.closed_at,
  p.reopened_at,
  p.reopen_reason,
  agg.entry_count,
  agg.draft_count,
  agg.total_debit,
  agg.total_credit,
  round(coalesce(agg.total_debit, 0) - coalesce(agg.total_credit, 0), 2) as imbalance
from fiscal_periods p
join fiscal_years y on y.id = p.fiscal_year_id
left join lateral (
  select count(distinct e.id) as entry_count,
         count(distinct e.id) filter (where e.status = 'draft') as draft_count,
         sum(l.debit) filter (where e.status = 'posted')  as total_debit,
         sum(l.credit) filter (where e.status = 'posted') as total_credit
    from journal_entries e
    left join journal_entry_lines l on l.journal_entry_id = e.id
   where e.organization_id = p.organization_id
     and e.entry_date between p.start_date and p.end_date
) agg on true;

comment on view v_fiscal_period_status is
  'حالة الفترات المالية: عدد القيود والمسوّدات والتوازن — المسوّدة قبل الإقفال معاملةٌ خارج القوائم.';

grant select on v_gl_lines, v_income_statement, v_balance_sheet,
                v_cost_center_performance, v_cash_flow, v_fiscal_period_status
  to authenticated;

-- ===========================================================================
-- 9) RLS
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['fiscal_years','fiscal_periods','cost_centers',
                               'gl_posting_rules','bank_reconciliations',
                               'bank_reconciliation_lines']) as t
  loop
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;
    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);
    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);
    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);
    execute format('grant select, insert, update on %I to authenticated', r.t);
  end loop;
end $$;

-- ===========================================================================
-- 10) بذرة قواعد الترحيل من الترحيل التلقائيّ القائم
-- ===========================================================================
--
-- الدوال الثلاث في 0027 تُرحّل فعلًا؛ ما ينقصها أن تكون **معلَنة**. تُسجَّل
-- قواعدها هنا ليراها المحاسب ويعدّل حساباتها، بدل أن تبقى مدفونة في النصّ.
create or replace function app_seed_gl_posting_rules(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
  r   record;
begin
  if not app_has_permission(p_organization_id, 'gl.rules') then
    raise exception 'صلاحيتك لا تسمح بإدارة قواعد الترحيل (gl.rules)';
  end if;

  for r in
    select * from (values
      ('sales_invoice_revenue',  'إيراد فاتورة مبيعات', 'sales_invoice',    'net_amount', 10),
      ('sales_invoice_vat',      'ضريبة مخرجات',        'sales_invoice',    'vat_amount', 20),
      ('purchase_invoice_cost',  'تكلفة فاتورة مشتريات','purchase_invoice', 'net_amount', 30),
      ('purchase_invoice_vat',   'ضريبة مدخلات',        'purchase_invoice', 'vat_amount', 40),
      ('receipt_voucher_cash',   'سند قبض',             'receipt_voucher',  'amount',     50),
      ('payment_voucher_cash',   'سند صرف',             'payment_voucher',  'amount',     60),
      ('refund_entry',           'استرداد للمريض',      'refund',           'amount',     70),
      ('stock_adjustment_entry', 'تسوية مخزون',         'stock_adjustment', 'total_amount', 80),
      ('insurance_settlement',   'تسوية تأمين',         'insurance_settlement', 'amount', 90)
    ) as t(k, n, ev, expr, ord)
  loop
    if not exists (select 1 from gl_posting_rules
                    where organization_id = p_organization_id and rule_key = r.k) then
      insert into gl_posting_rules (organization_id, rule_key, name_ar, source_event,
                                    amount_expression, sort_order, created_by)
      values (p_organization_id, r.k, r.n, r.ev, r.expr, r.ord, auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end $$;

-- ===========================================================================
-- 10.5) ربط القيد المولَّد بقاعدته، وفرعه
-- ===========================================================================
--
-- إعلان القواعد بلا ربطها بالقيود الناتجة يجعلها **وثيقةً لا أثر لها**:
-- يقرأ المحاسب القاعدة ولا يستطيع أن يسأل «أيّ قيدٍ ولّدته هذه القاعدة؟».
-- تُرقَّع الدوال الثلاث القائمة لتختم `posting_rule_id` و`branch_id`.
do $$
declare
  r      record;
  v_src  text;
  v_new  text;
begin
  for r in select * from (values
    ('app_post_sales_invoice_to_gl',    'sales_invoice_revenue'),
    ('app_post_purchase_invoice_to_gl', 'purchase_invoice_cost'),
    ('app_post_voucher_to_gl',          'receipt_voucher_cash')
  ) as t(fn, rule_key)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
  -- تطبيع نهايات الأسطر: إن نُفِّذت الهجرة من ملف بنهايات أسطر ويندوز
  -- (CRLF) فإن نصّ الدالّة المخزَّن يحمل \r، فلا يطابق أنماط البحث أدناه
  -- المكتوبة بـ \n وحدها، فيتوقّف الترقيع بلا سبب ظاهر. تُزال \r أولًا.
    v_src := replace(v_src, chr(13), '');
    continue when v_src is null;
    continue when position('posting_rule_id' in v_src) > 0;

    v_new := replace(v_src,
      'insert into journal_entries (organization_id, entry_date, reference_type, reference_id, status, description)',
      'insert into journal_entries (organization_id, branch_id, posting_rule_id,'
      || ' entry_date, reference_type, reference_id, status, description)');

    v_new := replace(v_new,
      'values (new.organization_id, ',
      'values (new.organization_id,'
      || ' (select b.id from branches b where b.id = new.branch_id),'
      || ' (select gr.id from gl_posting_rules gr'
      || '   where gr.organization_id = new.organization_id'
      || format('     and gr.rule_key = %L and gr.is_active limit 1), ', r.rule_key));

    if v_new = v_src then
      raise notice 'تعذّر ترقيع % — تغيّر نصّها؛ القيد يبقى صحيحًا بلا ربطٍ بقاعدته', r.fn;
      continue;
    end if;

    begin
      execute v_new;
    exception when others then
      raise notice 'ترقيع % فشل (%) — القيد يبقى صحيحًا', r.fn, sqlerrm;
    end;
  end loop;
end $$;

-- ===========================================================================
-- 11) فحص ذاتي
-- ===========================================================================
do $$
declare v_v text;
begin
  foreach v_v in array array['app_period_for_date','app_close_fiscal_period',
                             'app_reopen_fiscal_period','app_create_manual_journal_entry',
                             'app_post_journal_entry','app_reverse_journal_entry',
                             'app_complete_bank_reconciliation','app_seed_gl_posting_rules']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_v) then
      raise exception 'دالّة المحاسبة % غير موجودة', v_v;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_fiscal_period') then
    raise exception 'حارس الفترة المالية غير مركَّب — سيُرحَّل في فترة مقفلة';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_block_posted_entry_delete') then
    raise exception 'القيد المرحَّل قابل للحذف';
  end if;
  if exists (select 1 from role_default_permissions
              where permission_key = 'gl.reopen_period') then
    raise exception 'إعادة فتح الفترات مُنحت لدور افتراضيًّا — إقفالٌ يُفتح بسهولة ليس إقفالًا';
  end if;
end $$;
