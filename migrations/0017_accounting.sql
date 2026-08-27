-- ============================================================================
-- 0017_accounting.sql — المحاسبة ودليل الحسابات (Accounting / Chart of Accounts)
-- أول موديول من "مجموعة الإدارة" (محاسبة/مشتريات/مخزون/رسائل/تدقيق/رحلة المريض).
-- على عكس المشتريات والمخزون والرسائل وسجل التدقيق (التي لها جداول موجودة أصلًا
-- منذ 0001/0003/0009 وتحتاج فقط واجهة)، المحاسبة بمعنى "دفتر أستاذ عام" (General
-- Ledger) بقيود مزدوجة لا يوجد لها أي جدول حتى الآن — هذا تصميم مخطط جديد بالكامل.
--
-- فلسفة التصميم: هذا دفتر أستاذ **مستقل ومصاحب** (Shadow Ledger) يدعم القيود
-- اليدوية والتقارير المحاسبية القياسية (دليل الحسابات، ميزان المراجعة)، ولا
-- يُعيد هندسة الفوترة/السندات الموجودة (sales_invoices/financial_vouchers) ولا
-- يُنشئ قيودًا تلقائية منها — ربط ترحيل الفواتير/السندات إلى القيود مهمة محاسب
-- تتطلب تصميم "خريطة حسابات" لكل نوع عملية، وهي خارج نطاق هذه المرحلة، وستُبنى
-- كملف ترحيل لاحق منفصل إن احتاجها المستخدم صريحًا.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) دليل الحسابات — شجرة حسابات قابلة للتخصيص لكل مؤسسة
-- ---------------------------------------------------------------------------
create table if not exists chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_account_id uuid references chart_of_accounts(id) on delete set null,
  code text not null,
  name_ar text not null,
  name_en text,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index if not exists idx_chart_of_accounts_org on chart_of_accounts(organization_id);
create index if not exists idx_chart_of_accounts_parent on chart_of_accounts(parent_account_id);

-- ---------------------------------------------------------------------------
-- 2) القيود اليومية — رأس القيد وبنوده (قيد مزدوج: إجمالي المدين = إجمالي الدائن)
-- ---------------------------------------------------------------------------
create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entry_number bigint generated always as identity,
  entry_date date not null default current_date,
  description text,
  reference_type text not null default 'manual' check (reference_type in (
    'manual','sales_invoice','purchase_invoice','financial_voucher','opening_balance'
  )),
  reference_id uuid,               -- مرجع حر لأي جدول حسب reference_type (بلا FK صارم لتعدّد المصادر)
  status text not null default 'draft' check (status in ('draft','posted','void')),
  posted_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_journal_entries_org on journal_entries(organization_id, entry_date desc);
create index if not exists idx_journal_entries_reference on journal_entries(reference_type, reference_id) where reference_id is not null;

create table if not exists journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references chart_of_accounts(id) on delete restrict,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  description text,
  check (debit = 0 or credit = 0)    -- كل سطر مدين أو دائن فقط، لا كليهما معًا
);
create index if not exists idx_journal_entry_lines_entry on journal_entry_lines(journal_entry_id);
create index if not exists idx_journal_entry_lines_account on journal_entry_lines(account_id);

-- ---------------------------------------------------------------------------
-- 3) Trigger حماية: يمنع ترحيل (posted) قيد غير متوازن — المدين يجب أن يساوي
--    الدائن بالضبط، وهذا هو الشرط الجوهري لأي قيد مزدوج. يُفحَص فقط عند
--    الانتقال إلى status='posted'، بينما القيود في حالة draft تبقى قابلة للتعديل
--    الحر أثناء الإدخال.
-- ---------------------------------------------------------------------------
create or replace function app_validate_journal_entry_balance()
returns trigger
language plpgsql
as $$
declare
  total_debit numeric;
  total_credit numeric;
  line_count int;
begin
  if new.status = 'posted' and (old.status is distinct from 'posted') then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    into total_debit, total_credit, line_count
    from journal_entry_lines where journal_entry_id = new.id;

    if line_count = 0 then
      raise exception 'لا يمكن ترحيل قيد بلا أي بنود';
    end if;

    if total_debit <> total_credit then
      raise exception 'القيد غير متوازن: إجمالي المدين (%) لا يساوي إجمالي الدائن (%)', total_debit, total_credit;
    end if;

    new.posted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_journal_entry_balance on journal_entries;
create trigger trg_validate_journal_entry_balance
before update of status on journal_entries
for each row execute function app_validate_journal_entry_balance();

-- منع تعديل/حذف بنود قيد مُرحَّل فعليًا (posted) — يجب إنشاء قيد عكسي (reversal) بدلًا من التعديل
create or replace function app_prevent_posted_entry_line_changes()
returns trigger
language plpgsql
as $$
declare
  entry_status text;
  target_entry_id uuid;
begin
  target_entry_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  select status into entry_status from journal_entries where id = target_entry_id;
  if entry_status = 'posted' then
    raise exception 'لا يمكن تعديل أو حذف بنود قيد مُرحَّل — أنشئ قيد عكسي (reversal) بدلًا من ذلك';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_prevent_posted_entry_line_changes on journal_entry_lines;
create trigger trg_prevent_posted_entry_line_changes
before update or delete on journal_entry_lines
for each row execute function app_prevent_posted_entry_line_changes();

-- ---------------------------------------------------------------------------
-- 4) عرض حيّ: رصيد كل حساب (من القيود المُرحَّلة فقط posted)
-- ---------------------------------------------------------------------------
create or replace view v_account_balances as
select
  a.id as account_id,
  a.organization_id,
  a.code,
  a.name_ar,
  a.account_type,
  coalesce(sum(l.debit), 0) as total_debit,
  coalesce(sum(l.credit), 0) as total_credit,
  case
    when a.account_type in ('asset','expense') then coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
    else coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0)
  end as balance
from chart_of_accounts a
left join journal_entry_lines l on l.account_id = a.id
left join journal_entries je on je.id = l.journal_entry_id and je.status = 'posted'
group by a.id, a.organization_id, a.code, a.name_ar, a.account_type;

-- ---------------------------------------------------------------------------
-- 5) عرض حيّ: ميزان المراجعة (Trial Balance) — يجب أن يتساوى إجمالي المدين
--    والدائن عبر كل الحسابات إن كانت كل القيود متوازنة فعليًا (دليل تحقّق سريع)
-- ---------------------------------------------------------------------------
create or replace view v_trial_balance as
select organization_id, sum(total_debit) as grand_total_debit, sum(total_credit) as grand_total_credit
from v_account_balances
group by organization_id;

-- ---------------------------------------------------------------------------
-- 6) دليل حسابات افتراضي مبسَّط لكل مؤسسة جديدة — يُضاف الآن عبر توسعة Trigger
--    إنشاء المؤسسة الموجود أصلًا من 0001 (app_after_organization_created)
--    بدل تكرار منطق إنشاء المؤسسة هنا. الأسهل والأكثر أمانًا: دالة منفصلة
--    تُستدعى لاحقًا يدويًا أو من الواجهة لكل مؤسسة تريد تفعيل المحاسبة، بدل
--    فرضها تلقائيًا على كل مؤسسة (ليس كل عيادة تحتاج محاسبة تفصيلية).
-- ---------------------------------------------------------------------------
create or replace function app_seed_default_chart_of_accounts(target_organization_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  insert into chart_of_accounts (organization_id, code, name_ar, account_type)
  select target_organization_id, v.code, v.name_ar, v.account_type
  from (values
    ('1000', 'الأصول', 'asset'),
    ('1100', 'النقدية والبنوك', 'asset'),
    ('1200', 'الذمم المدينة (المرضى)', 'asset'),
    ('1300', 'المخزون', 'asset'),
    ('2000', 'الخصوم', 'liability'),
    ('2100', 'الذمم الدائنة (الموردون)', 'liability'),
    ('2200', 'ضريبة القيمة المضافة المستحقة', 'liability'),
    ('3000', 'حقوق الملكية', 'equity'),
    ('3100', 'رأس المال', 'equity'),
    ('3200', 'الأرباح المحتجزة', 'equity'),
    ('4000', 'الإيرادات', 'revenue'),
    ('4100', 'إيرادات الخدمات الطبية', 'revenue'),
    ('4200', 'إيرادات الصيدلية', 'revenue'),
    ('5000', 'المصروفات', 'expense'),
    ('5100', 'الرواتب والأجور', 'expense'),
    ('5200', 'مصروفات إيجار', 'expense'),
    ('5300', 'مصروفات تشغيلية متنوعة', 'expense')
  ) as v(code, name_ar, account_type)
  where not exists (
    select 1 from chart_of_accounts c where c.organization_id = target_organization_id and c.code = v.code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security — الكتابة مقيَّدة بالمحاسب/الأدمن، القراءة لكل الأعضاء
-- ---------------------------------------------------------------------------
alter table chart_of_accounts enable row level security;
alter table journal_entries enable row level security;
alter table journal_entry_lines enable row level security;

create policy "chart_of_accounts_read_members" on chart_of_accounts
  for select using (app_is_member(organization_id));
create policy "chart_of_accounts_manage_accountants" on chart_of_accounts
  for insert with check (
    app_is_org_admin(organization_id) or
    exists (select 1 from organization_memberships m where m.organization_id = chart_of_accounts.organization_id and m.user_id = auth.uid() and m.role_key = 'accountant' and m.is_active)
  );
create policy "chart_of_accounts_update_accountants" on chart_of_accounts
  for update using (
    app_is_org_admin(organization_id) or
    exists (select 1 from organization_memberships m where m.organization_id = chart_of_accounts.organization_id and m.user_id = auth.uid() and m.role_key = 'accountant' and m.is_active)
  );

create policy "journal_entries_read_members" on journal_entries
  for select using (app_is_member(organization_id));
create policy "journal_entries_manage_accountants" on journal_entries
  for insert with check (
    app_is_org_admin(organization_id) or
    exists (select 1 from organization_memberships m where m.organization_id = journal_entries.organization_id and m.user_id = auth.uid() and m.role_key = 'accountant' and m.is_active)
  );
create policy "journal_entries_update_accountants" on journal_entries
  for update using (
    app_is_org_admin(organization_id) or
    exists (select 1 from organization_memberships m where m.organization_id = journal_entries.organization_id and m.user_id = auth.uid() and m.role_key = 'accountant' and m.is_active)
  );

create policy "journal_entry_lines_read_members" on journal_entry_lines
  for select using (
    exists (select 1 from journal_entries je where je.id = journal_entry_lines.journal_entry_id and app_is_member(je.organization_id))
  );
create policy "journal_entry_lines_manage_accountants" on journal_entry_lines
  for insert with check (
    exists (
      select 1 from journal_entries je
      where je.id = journal_entry_lines.journal_entry_id
        and (
          app_is_org_admin(je.organization_id) or
          exists (select 1 from organization_memberships m where m.organization_id = je.organization_id and m.user_id = auth.uid() and m.role_key = 'accountant' and m.is_active)
        )
    )
  );
create policy "journal_entry_lines_update_accountants" on journal_entry_lines
  for update using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_entry_lines.journal_entry_id
        and (
          app_is_org_admin(je.organization_id) or
          exists (select 1 from organization_memberships m where m.organization_id = je.organization_id and m.user_id = auth.uid() and m.role_key = 'accountant' and m.is_active)
        )
    )
  );
create policy "journal_entry_lines_delete_accountants" on journal_entry_lines
  for delete using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_entry_lines.journal_entry_id
        and (
          app_is_org_admin(je.organization_id) or
          exists (select 1 from organization_memberships m where m.organization_id = je.organization_id and m.user_id = auth.uid() and m.role_key = 'accountant' and m.is_active)
        )
    )
  );

-- ============================================================================
-- نهاية 0017_accounting.sql
-- ============================================================================
