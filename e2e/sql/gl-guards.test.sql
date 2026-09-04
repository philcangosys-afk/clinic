-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات المحاسبة العامة — 0099
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/gl-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- المحاسبة لا تخطئ بصوتٍ عالٍ: القيد غير المتوازن، والفترة التي تُعدَّل بعد
-- إقفالها، والقيد المحذوف — كلّها تمرّ صامتةً وتظهر بعد شهور في قائمةٍ لا
-- تتطابق. لذلك كل فحص هنا يحاول الخطأ ويتوقّع الرفض.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_acc     uuid;
  v_branch  uuid;
  v_clinic  uuid;
  v_year    uuid;
  v_p1      uuid;
  v_p2      uuid;
  v_cc      uuid;
  v_cash    uuid;
  v_rev     uuid;
  v_exp     uuid;
  v_je      uuid;
  v_rev_je  uuid;
  v_num     numeric;
  v_txt     text;
  v_int     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'gl-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'gl-acc@test.local')
    returning id into v_acc;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار المحاسبة', 'medical_center', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_acc, 'accountant', true);

  insert into branches (organization_id, name) values (v_org, 'فرع المحاسبة')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','GC1','name','عيادة','branch_id', v_branch));

  -- حسابات
  insert into chart_of_accounts (organization_id, code, name_ar, account_type)
    values (v_org, '1101', 'النقد بالصندوق', 'asset') returning id into v_cash;
  insert into chart_of_accounts (organization_id, code, name_ar, account_type)
    values (v_org, '4101', 'إيراد الخدمات الطبية', 'revenue') returning id into v_rev;
  insert into chart_of_accounts (organization_id, code, name_ar, account_type)
    values (v_org, '5101', 'مصروف الرواتب', 'expense') returning id into v_exp;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) السنوات لا تتداخل
  -- ═════════════════════════════════════════════════════════════════════════
  insert into fiscal_years (organization_id, name, start_date, end_date, created_by)
    values (v_org, 'السنة المالية 2026', date '2026-01-01', date '2026-12-31', v_owner)
    returning id into v_year;

  begin
    insert into fiscal_years (organization_id, name, start_date, end_date, created_by)
      values (v_org, 'سنة متداخلة', date '2026-06-01', date '2027-05-31', v_owner);
    raise exception 'فشل: قُبلت سنتان متداخلتان — يومٌ في سنتين يعني قوائم متناقضة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;  -- exclusion constraint أو خطأ مكافئ
  end;
  raise notice '✅ ١) السنوات المالية لا تتداخل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) الفترة تُشتقّ من التاريخ
  -- ═════════════════════════════════════════════════════════════════════════
  insert into fiscal_periods (organization_id, fiscal_year_id, period_number, name,
                              start_date, end_date)
    values (v_org, v_year, 1, 'يناير', date '2026-01-01', date '2026-01-31')
    returning id into v_p1;
  insert into fiscal_periods (organization_id, fiscal_year_id, period_number, name,
                              start_date, end_date)
    values (v_org, v_year, 2, 'فبراير', date '2026-02-01', date '2026-02-28')
    returning id into v_p2;

  if (select id from app_period_for_date(v_org, date '2026-01-15')) <> v_p1 then
    raise exception 'فشل: الفترة لا تُشتقّ من التاريخ';
  end if;
  raise notice '✅ ٢) الفترة تُشتقّ من تاريخ القيد تلقائيًّا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) القيد اليدويّ: سببٌ إلزاميّ، وتوازنٌ إلزاميّ
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_create_manual_journal_entry(
      v_org, date '2026-01-10', 'قيد', '  ',
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_rev,  'debit', 0,   'credit', 100)));
    raise exception 'فشل: قُبل قيد يدويّ بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب القيد اليدويّ%' then raise; end if;
  end;

  begin
    perform app_create_manual_journal_entry(
      v_org, date '2026-01-10', 'قيد', 'تصحيح',
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_rev,  'debit', 0,   'credit', 90)));
    raise exception 'فشل: قُبل قيد غير متوازن';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%غير متوازن%' then raise; end if;
  end;
  raise notice '✅ ٣) القيد اليدويّ لا يمرّ بلا سبب ولا بلا توازن';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) مراكز التكلفة على البند
  -- ═════════════════════════════════════════════════════════════════════════
  insert into cost_centers (organization_id, branch_id, code, name_ar, center_type,
                            clinic_id, created_by)
    values (v_org, v_branch, 'CC-1', 'عيادة الأسنان', 'clinic', v_clinic, v_owner)
    returning id into v_cc;

  v_je := app_create_manual_journal_entry(
    v_org, date '2026-01-15', 'إيراد يناير', 'قيد افتتاحيّ للاختبار',
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'debit', 1000, 'credit', 0,
                         'cost_center_id', v_cc),
      jsonb_build_object('account_id', v_rev,  'debit', 0, 'credit', 1000,
                         'cost_center_id', v_cc)),
    v_branch);

  if (select fiscal_period_id from journal_entries where id = v_je) <> v_p1 then
    raise exception 'فشل: القيد لم يُربط بفترته';
  end if;
  if (select count(*) from journal_entry_lines
       where journal_entry_id = v_je and cost_center_id = v_cc) <> 2 then
    raise exception 'فشل: مركز التكلفة لم يُسجَّل على البنود';
  end if;
  raise notice '✅ ٤) القيد يحمل فرعه وفترته ومركز تكلفة بنوده';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الترحيل، والقوائم تقرأ المرحَّل وحده
  -- ═════════════════════════════════════════════════════════════════════════
  if exists (select 1 from v_gl_lines where journal_entry_id = v_je) then
    raise exception 'فشل: المسوّدة تظهر في القوائم — رقمٌ لم يُقَرّ بعد';
  end if;

  perform app_post_journal_entry(v_je);
  if (select status from journal_entries where id = v_je) <> 'posted' then
    raise exception 'فشل: القيد لم يُرحَّل';
  end if;
  if not exists (select 1 from v_gl_lines where journal_entry_id = v_je) then
    raise exception 'فشل: القيد المرحَّل لا يظهر في القوائم';
  end if;
end $$;

do $$
declare
  v_org uuid; v_rev uuid; v_cash uuid; v_num numeric; v_je uuid; v_cc uuid;
  v_owner uuid; v_branch uuid; v_p1 uuid; v_p2 uuid; v_acc uuid; v_int int;
  v_rev_je uuid; v_txt text;
begin
  select id into v_org from organizations where name = 'منشأة اختبار المحاسبة';
  select id into v_owner from auth.users where email = 'gl-owner@test.local';
  select id into v_acc from auth.users where email = 'gl-acc@test.local';
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  select id into v_branch from branches where organization_id = v_org limit 1;
  select id into v_cash from chart_of_accounts where organization_id = v_org and code = '1101';
  select id into v_rev  from chart_of_accounts where organization_id = v_org and code = '4101';
  select id into v_cc   from cost_centers where organization_id = v_org and code = 'CC-1';
  select id into v_p1 from fiscal_periods where organization_id = v_org and period_number = 1;
  select id into v_p2 from fiscal_periods where organization_id = v_org and period_number = 2;
  select id into v_je from journal_entries
   where organization_id = v_org and description = 'إيراد يناير';

  select sum(amount) into v_num from v_income_statement
   where organization_id = v_org and account_id = v_rev;
  if v_num <> 1000 then
    raise exception 'فشل: الإيراد في القائمة % لا ١٠٠٠ — عُرض بإشارة الدفاتر', v_num;
  end if;
  select sum(amount) into v_num from v_balance_sheet
   where organization_id = v_org and account_id = v_cash;
  if v_num <> 1000 then
    raise exception 'فشل: النقد في الميزانية % لا ١٠٠٠', v_num;
  end if;
  raise notice '✅ ٥) القوائم تقرأ المرحَّل وحده، وبإشارات العرض لا الدفاتر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) أداء مراكز التكلفة والفروع
  -- ═════════════════════════════════════════════════════════════════════════
  select revenue into v_num from v_cost_center_performance
   where cost_center_id = v_cc;
  if v_num <> 1000 then
    raise exception 'فشل: إيراد مركز التكلفة % لا ١٠٠٠', v_num;
  end if;
  if not exists (select 1 from v_cash_flow
                  where organization_id = v_org and account_id = v_cash
                    and net_cash_flow = 1000) then
    raise exception 'فشل: التدفّق النقدي لا يعكس حركة الصندوق';
  end if;
  raise notice '✅ ٦) أداء مراكز التكلفة والتدفّق النقدي يُحسبان من نفس المصدر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) لا إقفال وفي الفترة مسوّدات
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_draft uuid;
  begin
    v_draft := app_create_manual_journal_entry(
      v_org, date '2026-01-20', 'مسوّدة عالقة', 'اختبار الإقفال',
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', 50, 'credit', 0),
        jsonb_build_object('account_id', v_rev,  'debit', 0, 'credit', 50)));

    begin
      perform app_close_fiscal_period(v_p1);
      raise exception 'فشل: أُقفلت فترة فيها مسوّدات — معاملةٌ خارج القوائم';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%مسوّدة%' then raise; end if;
    end;

    delete from journal_entry_lines where journal_entry_id = v_draft;
    delete from journal_entries where id = v_draft;
  end;
  raise notice '✅ ٧) لا إقفال وفي الفترة قيدٌ لم يُرحَّل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الإقفال يمنع الترحيل، ويسمح بحفظ المسوّدة
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_close_fiscal_period(v_p1);
  if (select status from fiscal_periods where id = v_p1) <> 'closed' then
    raise exception 'فشل: الفترة لم تُقفل';
  end if;

  declare v_late uuid;
  begin
    -- المسوّدة تُحفظ (قد تُرحَّل بعد إعادة الفتح)
    v_late := app_create_manual_journal_entry(
      v_org, date '2026-01-25', 'قيد متأخّر', 'وصل بعد الإقفال',
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', 70, 'credit', 0),
        jsonb_build_object('account_id', v_rev,  'debit', 0, 'credit', 70)));
    begin
      perform app_post_journal_entry(v_late);
      raise exception 'فشل: رُحّل قيد في فترة مقفلة — القوائم صدرت';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%مقفلة%' then raise; end if;
    end;
    delete from journal_entry_lines where journal_entry_id = v_late;
    delete from journal_entries where id = v_late;
  end;
  raise notice '✅ ٨) الفترة المقفلة تمنع الترحيل لا الحفظ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) إعادة الفتح: صلاحية منفصلة وسببٌ إلزاميّ
  -- ═════════════════════════════════════════════════════════════════════════
  if exists (select 1 from role_default_permissions
              where permission_key = 'gl.reopen_period') then
    raise exception 'فشل: إعادة الفتح مُنحت افتراضيًّا لدور — الإقفال يصير شكليًّا';
  end if;
  begin
    perform app_reopen_fiscal_period(v_p1, '  ');
    raise exception 'فشل: أُعيد الفتح بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب إعادة الفتح%' then raise; end if;
  end;
  perform app_reopen_fiscal_period(v_p1, 'وصلت فاتورة متأخّرة من مورد');
  if (select status from fiscal_periods where id = v_p1) <> 'open' then
    raise exception 'فشل: الفترة لم تُفتح';
  end if;
  if (select reopen_reason from fiscal_periods where id = v_p1) is null then
    raise exception 'فشل: سبب إعادة الفتح لم يُحفظ';
  end if;
  raise notice '✅ ٩) إعادة الفتح بصلاحية منفصلة وسببٍ محفوظ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) الإقفال النهائيّ لا يُفتح
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_close_fiscal_period(v_p1, true);
  if (select status from fiscal_periods where id = v_p1) <> 'locked' then
    raise exception 'فشل: الإقفال النهائيّ لم يُطبَّق';
  end if;
  begin
    perform app_reopen_fiscal_period(v_p1, 'محاولة');
    raise exception 'فشل: فُتحت فترة مقفلة نهائيًّا';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%نهائيًّا%' then raise; end if;
  end;
  raise notice '✅ ١٠) المقفلة نهائيًّا لا تُفتح — بعد التدقيق لا رجعة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) القيد المرحَّل لا يُحذف، ويُعكس بقيدٍ مضادّ في فترة مفتوحة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    delete from journal_entries where id = v_je;
    raise exception 'فشل: حُذف قيد مرحَّل — التسلسل انقطع والأثر ضاع';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُحذف%' then raise; end if;
  end;

  begin
    perform app_reverse_journal_entry(v_je, '  ');
    raise exception 'فشل: عُكس القيد بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب العكس%' then raise; end if;
  end;

  -- فترة يناير مقفلة نهائيًّا، فالعكس يقع في فبراير المفتوحة
  v_rev_je := app_reverse_journal_entry(v_je, 'خطأ في الحساب المدين');
  if (select entry_date from journal_entries where id = v_rev_je) < date '2026-02-01' then
    raise exception 'فشل: عُكس القيد داخل الفترة المقفلة — الإقفال لا معنى له';
  end if;
  if (select status from journal_entries where id = v_rev_je) <> 'posted' then
    raise exception 'فشل: قيد العكس لم يُرحَّل';
  end if;
  if (select reversed_by_id from journal_entries where id = v_je) <> v_rev_je then
    raise exception 'فشل: القيد الأصليّ لا يشير إلى عكسه';
  end if;

  -- العكس يُصفّي الأثر: مجموع الإيراد صفر
  select sum(amount) into v_num from v_income_statement
   where organization_id = v_org and account_id = v_rev;
  if round(coalesce(v_num, 0), 2) <> 0 then
    raise exception 'فشل: العكس لم يُصفِّ الأثر (المتبقّي %)', v_num;
  end if;

  begin
    perform app_reverse_journal_entry(v_je, 'مرّة ثانية');
    raise exception 'فشل: عُكس القيد مرّتين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%معكوس سلفًا%' then raise; end if;
  end;
  raise notice '✅ ١١) المرحَّل لا يُحذف، ويُعكس بقيدٍ مضادّ خارج الفترة المقفلة، مرّةً واحدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) قواعد الترحيل معلَنة لا مدفونة
  -- ═════════════════════════════════════════════════════════════════════════
  v_int := app_seed_gl_posting_rules(v_org);
  if v_int < 5 then
    raise exception 'فشل: قواعد الترحيل لم تُسجَّل (%)', v_int;
  end if;
  if not exists (select 1 from gl_posting_rules
                  where organization_id = v_org and source_event = 'sales_invoice') then
    raise exception 'فشل: لا قاعدة ترحيل لفواتير المبيعات';
  end if;
  -- التشغيل مرّتين لا يكرّر
  if app_seed_gl_posting_rules(v_org) <> 0 then
    raise exception 'فشل: تكرّرت قواعد الترحيل';
  end if;
  raise notice '✅ ١٢) قواعد الترحيل معلَنة في جدول، ولا تتكرّر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) التسوية البنكية لا تكتمل بفرقٍ غير مفسَّر
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_bank uuid; v_book numeric;
  begin
    insert into bank_reconciliations (organization_id, branch_id, account_id,
                                      statement_date, statement_balance, created_by)
      values (v_org, v_branch, v_cash, date '2026-03-31', 999999, v_owner)
      returning id into v_bank;
    begin
      perform app_complete_bank_reconciliation(v_bank);
      raise exception 'فشل: اكتملت تسوية بفرقٍ غير مفسَّر — لم تُسوِّ شيئًا';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%غير مفسَّر%' then raise; end if;
    end;

    -- الرصيد الدفتري الحقيقيّ: القيد الأصليّ + عكسه = صفر
    select coalesce(sum(l.debit - l.credit), 0) into v_book
      from journal_entry_lines l
      join journal_entries e on e.id = l.journal_entry_id
     where l.account_id = v_cash and e.status = 'posted'
       and e.entry_date <= date '2026-03-31';

    update bank_reconciliations set statement_balance = v_book where id = v_bank;
    perform app_complete_bank_reconciliation(v_bank);
    if (select status from bank_reconciliations where id = v_bank) <> 'completed' then
      raise exception 'فشل: التسوية المتوازنة لم تكتمل';
    end if;
  end;
  raise notice '✅ ١٣) التسوية البنكية لا تكتمل إلا بفرقٍ مفسَّر بالكامل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) حالة الفترات: المسوّدات والتوازن ظاهران قبل الإقفال
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_fiscal_period_status
                  where fiscal_period_id = v_p2 and coalesce(imbalance, 0) = 0) then
    raise exception 'فشل: حالة الفترة لا تُظهر التوازن';
  end if;
  if (select draft_count from v_fiscal_period_status where fiscal_period_id = v_p1) is null then
    raise exception 'فشل: عدد المسوّدات غير محسوب';
  end if;
  raise notice '✅ ١٤) حالة الفترة تُظهر المسوّدات والتوازن قبل الإقفال';

  raise notice '——— كل فحوص المحاسبة العامة نجحت ———';
end $$;

rollback;
