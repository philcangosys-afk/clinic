-- ============================================================================
-- RESET — تفريغ المخزون والمشتريات والموردين والموظفين قبل التشغيل الحقيقي
-- ============================================================================
--
-- ⚠ **حذفٌ نهائيّ لا رجعة فيه.** يُنفَّذ مرّةً واحدة قبل التشغيل الحقيقي،
-- ولا يُنفَّذ بعدها أبدًا. خذ نسخة احتياطية من Supabase أوّلًا
-- (Database ← Backups) إن أردت طريق عودة.
--
-- رفيق `RESET_patients_and_invoices.sql`: يُنفَّذ قبله أو بعده، لا فرق.
--
-- ── ما يُحذف ──────────────────────────────────────────────────────────────
--
--   المخزون   حركات المخزون، الدفعات (الكمّيات)، الحجوزات، الجرد وبنوده،
--             التحويلات بين المستودعات وبنودها — فتصير كلّ الكمّيات صفرًا.
--   المشتريات طلبات الشراء، أوامر الشراء، الاستلام، فواتير الشراء، المرتجعات،
--             مصاريف الشراء — ببنودها كلّها.
--   الموردون  كلّ الموردين **عدا معامل الأسنان** (`is_dental_lab`) فهي جهاتٌ
--             يُرسَل إليها العمل لا موردو مخزون، وأسعارها معرَّفة عليها.
--   الموظفون  كلّ ملفّات الموظفين ومعها: العقود، الوثائق، السلف، سجلّ
--             المناصب، مكوّنات الرواتب، المناوبات المسندة، الحضور، الإجازات
--             وأرصدتها، مسيّرات الرواتب وبنودها، تقييمات الأداء، التدريب.
--             والرقم الوظيفيّ (ASN) يعود إلى أوّله.
--   المال     سندات الموردين وسندات الرواتب والسلف (ما له مورّدٌ أو موظّف)،
--             وقيود اليومية الآلية لفواتير الشراء والسندات المحذوفة (وعكوسها).
--
-- ── ما يبقى ────────────────────────────────────────────────────────────────
--
--   تعريفات الأصناف (أدوية، مستهلكات، منتجات) بأسمائها وأكوادها وأسعارها —
--   بكمّية صفر، لتُدخَل عليها الأرصدة الافتتاحية الحقيقية. والخدمات.
--   المستودعات ومواقعها وإعدادات الطلب لكلّ صنف. معامل الأسنان.
--   **حسابات الدخول وبطاقات الأطباء** — يُفكّ ربطها بملفّ الموظف فقط.
--   إعدادات الموارد البشرية: أنواع الإجازات، مكوّنات الراتب، قوالب المناوبات،
--   معايير التقييم، برامج التدريب، الوظائف والمرشّحون. الأصول (يُفكّ ربطها
--   بفاتورة الشراء أو المورد فقط). المرضى والفواتير (لها ملفّها).
--
-- ── كيف يُعرف ما يتبع ما ─────────────────────────────────────────────────
--
-- لا بقائمةٍ مكتوبة وحدها: القائمة أدناه هي **الجذور**، ثمّ تُقرأ القيود
-- الأجنبية من القاعدة نفسها ويُتتبَّع كلّ ما يشير إلى صفٍّ محذوف:
--   * مرجعٌ إلزاميّ (not null) أو «حذف متتالٍ» ⇒ الصفّ تابعٌ فيُحذف معه
--   * مرجعٌ اختياريّ ⇒ يُفرَّغ المرجع ويبقى الصفّ (طبيبٌ كان مربوطًا بموظف)
--
-- **حارس:** إن قاد التتبّع إلى حذف صفٍّ من جدولٍ يجب أن يبقى (الأصناف،
-- الأطباء، الحسابات، المستودعات، العيادات، الأصول…) توقّف كلّ شيء قبل حذف
-- صفٍّ واحد، مع اسم الجدول. ولا يُخمَّن.
--
-- منشأةٌ واحدة في كلّ تنفيذ، وكلّه في معاملةٍ واحدة: أيّ خطأ يُعيد كلّ شيء.
-- ============================================================================

begin;

do $$
declare
  v_org        uuid;
  v_rel        record;
  v_fk         record;
  v_n          bigint;
  v_added      bigint;
  v_pass       int;
  v_left       int;
  v_progress   boolean;
  v_bad        text;
  v_has        boolean;
  v_emp        int;
  v_dist       int;
  v_t          text;

  -- الجذور: كلّ صفوف المنشأة في هذه الجداول
  v_roots text[] := array[
    -- المخزون
    'inventory_movements', 'inventory_lots', 'inventory_reservations',
    'stock_counts', 'stock_count_items', 'stock_transfers', 'stock_transfer_items',
    -- المشتريات
    'purchase_requests', 'purchase_request_items', 'purchase_orders', 'purchase_order_items',
    'goods_receipts', 'goods_receipt_items', 'purchase_invoices', 'purchase_returns',
    'purchase_return_items', 'purchase_expenses',
    -- الموظفون
    'employees', 'employee_contracts', 'employee_documents', 'employee_loans',
    'employee_position_history', 'employee_salary_components', 'employee_shift_assignments',
    'attendance_records', 'leave_balances', 'leave_requests', 'payroll_runs',
    'payroll_run_items', 'payroll_item_details', 'performance_reviews',
    'training_enrollments', 'shift_swap_requests'];

  -- ما يجب أن يبقى: إن قاد التتبّع إلى حذف صفٍّ منه توقّف كلّ شيء
  v_protected text[] := array[
    'organizations', 'branches', 'clinics', 'departments', 'warehouses', 'warehouse_locations',
    'items', 'item_stock_settings', 'item_branches', 'price_lists', 'price_list_items',
    'doctors', 'organization_memberships', 'organization_roles', 'patients',
    'chart_of_accounts', 'lookup_values', 'lookup_categories', 'cost_centers',
    'shift_templates', 'leave_types', 'salary_components', 'performance_review_criteria',
    'performance_review_cycles', 'training_programs', 'job_postings', 'candidates',
    'assets', 'maintenance_orders', 'maintenance_plans', 'purchase_approval_rules',
    'zatca_onboarding_settings', 'organization_vat_settings', 'business_day_settings'];
begin
  -- ══ المنشأة ══════════════════════════════════════════════════════════════
  v_org := nullif(current_setting('zaincare.target_org', true), '')::uuid;
  if v_org is null then
    select id into v_org from public.organizations
     where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
     order by created_at limit 1;
  end if;
  if v_org is null then
    select id into v_org from public.organizations order by created_at limit 1;
  end if;
  if v_org is null then
    raise exception 'لا توجد منشأة في هذه القاعدة';
  end if;
  perform set_config('zaincare.reset_org', v_org::text, false);

  -- ══ ١) الجذور ═════════════════════════════════════════════════════════════
  -- المعرّف نصًّا: جداول بمعرّف uuid وأخرى بمعرّف رقميّ
  create temp table _del (tbl text not null, id text not null, primary key (tbl, id)) on commit drop;
  create temp table _nul (tbl text not null, col text not null, parent text not null,
                          primary key (tbl, col, parent)) on commit drop;

  foreach v_t in array v_roots loop
    if to_regclass('public.' || v_t) is not null
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_t and column_name = 'organization_id')
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_t and column_name = 'id') then
      execute format('insert into _del select %L, id::text from public.%I where organization_id = $1 on conflict do nothing',
                     v_t, v_t) using v_org;
    end if;
  end loop;

  -- الموردون — عدا معامل الأسنان
  insert into _del
  select 'distributors', d.id::text from public.distributors d
   where d.organization_id = v_org and not coalesce(d.is_dental_lab, false)
  on conflict do nothing;

  -- سندات الموردين والرواتب والسلف
  begin
    insert into _del
    select 'financial_vouchers', v.id::text from public.financial_vouchers v
     where v.organization_id = v_org
       and ((v.distributor_id is not null
             and v.distributor_id::text in (select id from _del where tbl = 'distributors'))
         or v.employee_ref_id is not null
         or v.voucher_type = 'salary')
    on conflict do nothing;
  exception when undefined_table or undefined_column then
    raise notice 'تُخطّي السندات: أعمدتها غير موجودة في هذه القاعدة';
  end;

  -- ══ ٢) تتبّع ما يتبع — من القيود الأجنبية في القاعدة ══════════════════════
  --
  -- كلّ قيدٍ أجنبيّ يشير إلى عمود `id` في جدولٍ له صفوفٌ محذوفة، بما فيها
  -- القيود المركّبة (organization_id, x_id) → (organization_id, id): عمود
  -- الابن المقابل لـ`id` هو المرجع.
  v_pass := 0;
  loop
    v_pass := v_pass + 1;
    v_added := 0;
    for v_fk in
      select ch.relname::text as child, ca.attname::text as col, pa.relname::text as parent,
             ca.attnotnull as required, c.confdeltype as on_delete,
             exists (select 1 from pg_attribute x
                      where x.attrelid = c.conrelid and x.attname = 'id' and not x.attisdropped) as child_has_id
        from pg_constraint c
        join pg_class ch       on ch.oid = c.conrelid
        join pg_namespace chn  on chn.oid = ch.relnamespace
        join pg_class pa       on pa.oid = c.confrelid
        join pg_namespace pan  on pan.oid = pa.relnamespace
        join lateral unnest(c.conkey, c.confkey) as k(child_att, parent_att) on true
        join pg_attribute ca   on ca.attrelid = c.conrelid  and ca.attnum = k.child_att
        join pg_attribute pk   on pk.attrelid = c.confrelid and pk.attnum = k.parent_att
       where c.contype = 'f'
         and chn.nspname = 'public' and pan.nspname = 'public'
         and pk.attname = 'id'
         and pa.relname in (select distinct tbl from _del)
    loop
      if v_fk.required or v_fk.on_delete = 'c' then
        if v_fk.child_has_id then
          execute format(
            'insert into _del select %L, c.id::text from public.%I c where c.%I::text in (select id from _del where tbl = %L) on conflict do nothing',
            v_fk.child, v_fk.child, v_fk.col, v_fk.parent);
          get diagnostics v_n = row_count;
          v_added := v_added + v_n;
        else
          -- جدول ربطٍ بلا معرّف: يُحذف بمرجعه مباشرةً (أدناه)
          insert into _nul values (v_fk.child, v_fk.col, '!' || v_fk.parent) on conflict do nothing;
        end if;
      else
        insert into _nul values (v_fk.child, v_fk.col, v_fk.parent) on conflict do nothing;
      end if;
    end loop;
    exit when v_added = 0;
    if v_pass > 50 then
      raise exception 'التتبّع لم يستقرّ بعد 50 دورة — توقّف احتياطًا';
    end if;
  end loop;

  -- ══ ٣) الحارس — قبل أيّ حذف ═══════════════════════════════════════════════
  select string_agg(format('%s (%s صفًّا)', tbl, n), '، ')
    into v_bad
    from (select tbl, count(*) n from _del where tbl = any(v_protected) group by tbl) x;
  if v_bad is null then
    select string_agg(distinct tbl, '، ') into v_bad
      from _nul where parent like '!%' and tbl = any(v_protected);
  end if;
  if v_bad is not null then
    raise exception 'توقّف قبل أيّ حذف: التتبّع يقود إلى حذف صفوف من جداول يجب أن تبقى: %. أرسل هذه الرسالة لمراجعتها.', v_bad;
  end if;

  select count(*) into v_emp  from _del where tbl = 'employees';
  select count(*) into v_dist from _del where tbl = 'distributors';
  raise notice 'يُفرَّغ من المنشأة %: % موظفًا، % مورّدًا', v_org, v_emp, v_dist;
  for v_rel in select tbl, count(*) n from _del group by tbl order by tbl loop
    raise notice '  % — % صفًّا', v_rel.tbl, v_rel.n;
  end loop;

  -- ══ ٤) تعطيل حُرّاس المنع داخل هذه المعاملة وحدها ══════════════════════════
  -- (كما في RESET_patients_and_invoices: حُرّاس منع حذف الحركات والفواتير
  -- الصادرة صحيحة أثناء التشغيل، والتفريغ ليس تعديل سطر. حُرّاس المفاتيح
  -- الأجنبية لا تُمَسّ، فالترتيب يبقى محروسًا.)
  for v_rel in
    select distinct c.relname as tbl
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I disable trigger user', v_rel.tbl);
  end loop;

  -- ══ ٥) تفريغ المراجع الاختيارية ═══════════════════════════════════════════
  -- طبيبٌ أو حسابٌ أو أصلٌ كان يشير إلى موظفٍ أو موردٍ أو فاتورة شراء: يبقى،
  -- ويُفرَّغ المرجع وحده.
  -- (صفٌّ سيُحذف هو نفسه لا يُفرَّغ مرجعه — لا معنى لتعديل ما سيزول)
  for v_rel in select * from _nul where parent not like '!%' loop
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_rel.tbl and column_name = 'id')
      into v_has;
    execute format(
      'update public.%I set %I = null where %I::text in (select id from _del where tbl = %L)'
      || case when v_has then ' and id::text not in (select id from _del where tbl = %L)' else '' end,
      v_rel.tbl, v_rel.col, v_rel.col, v_rel.parent, v_rel.tbl);
    get diagnostics v_n = row_count;
    if v_n > 0 then
      raise notice '  فُرِّغ المرجع: %.% — % صفًّا', v_rel.tbl, v_rel.col, v_n;
    end if;
  end loop;

  -- جداول الربط بلا معرّف
  for v_rel in select * from _nul where parent like '!%' loop
    execute format(
      'delete from public.%I where %I::text in (select id from _del where tbl = %L)',
      v_rel.tbl, v_rel.col, substr(v_rel.parent, 2));
  end loop;

  -- ══ ٦) الحذف — من الابن إلى الأب، بمحاولاتٍ متتالية ═════════════════════
  --
  -- لا يُكتب الترتيب باليد: كلّ جدولٍ يُحاوَل حذفه، فإن رفضه قيدٌ أجنبيّ
  -- (ابنٌ لم يُحذف بعد) أُعيدت محاولته في الدورة التالية. وإن مرّت دورةٌ بلا
  -- تقدّم توقّف كلّ شيء — فلا يبقى نصف حذف.
  create temp table _todo (tbl text primary key) on commit drop;
  insert into _todo select distinct tbl from _del;

  loop
    v_progress := false;
    for v_rel in select tbl from _todo loop
      begin
        execute format('delete from public.%I where id::text in (select id from _del where tbl = %L)',
                       v_rel.tbl, v_rel.tbl);
        delete from _todo where tbl = v_rel.tbl;
        v_progress := true;
      exception when foreign_key_violation then
        null;   -- يُعاد في الدورة التالية
      end;
    end loop;
    exit when not exists (select 1 from _todo);
    if not v_progress then
      select string_agg(tbl, '، ') into v_bad from _todo;
      raise exception 'تعذّر الحذف: جداول يمنعها مرجعٌ لم يُتتبَّع: %', v_bad;
    end if;
  end loop;

  -- الرقم الوظيفيّ يعود إلى أوّله
  begin
    delete from public.employee_number_sequences where organization_id = v_org;
  exception when undefined_table then null;
  end;

  -- ══ ٧) قيود اليومية الآلية لفواتير الشراء والسندات المحذوفة ═══════════════
  begin
    create temp table _je (id uuid primary key) on commit drop;
    insert into _je
    select e.id
      from public.journal_entries e
     where e.organization_id = v_org
       and ((e.reference_type = 'purchase_invoice'
             and not exists (select 1 from public.purchase_invoices x where x.id = e.reference_id))
         or (e.reference_type = 'financial_voucher'
             and not exists (select 1 from public.financial_vouchers x where x.id = e.reference_id)));
    begin
      loop
        insert into _je
        select e.id from public.journal_entries e
         where e.reversal_of_id in (select id from _je)
        on conflict do nothing;
        get diagnostics v_n = row_count;
        exit when v_n = 0;
      end loop;
    exception when undefined_column then null;
    end;
    begin
      delete from public.bank_reconciliation_lines
       where journal_entry_line_id in (select id from public.journal_entry_lines
                                        where journal_entry_id in (select id from _je));
    exception when undefined_table or undefined_column then null;
    end;
    delete from public.journal_entry_lines where journal_entry_id in (select id from _je);
    delete from public.journal_entries     where id in (select id from _je);
    get diagnostics v_n = row_count;
    raise notice 'حُذف % قيدًا آليًّا لفواتير شراء وسندات', v_n;
  exception when undefined_table or undefined_column then
    raise notice 'تُخطّي قيود اليومية: الجداول أو الأعمدة غير موجودة';
  end;

  -- ══ ٨) الترقيم الداخليّ يعود إلى أوّله — لما فرغ جدوله كلّه ═══════════════
  for v_rel in
    select s.oid::regclass::text as seq, t.relname as tbl, a.attname as col
      from pg_class s
      join pg_depend d     on d.objid = s.oid and d.classid = 'pg_class'::regclass
                          and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
      join pg_class t      on t.oid = d.refobjid
      join pg_namespace n  on n.oid = t.relnamespace
      join pg_attribute a  on a.attrelid = t.oid and a.attnum = d.refobjsubid
     where s.relkind = 'S' and n.nspname = 'public'
       and (t.relname = any(v_roots) or t.relname in ('distributors', 'purchase_invoice_items',
                                                     'financial_vouchers', 'journal_entries'))
  loop
    execute format('select exists (select 1 from public.%I)', v_rel.tbl) into v_has;
    if not v_has then
      perform setval(v_rel.seq, 1, false);
      raise notice 'الترقيم يبدأ من 1: %.%', v_rel.tbl, v_rel.col;
    end if;
  end loop;

  -- ══ ٩) إعادة الحُرّاس ═════════════════════════════════════════════════════
  for v_rel in
    select distinct c.relname as tbl
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I enable trigger user', v_rel.tbl);
  end loop;
end $$;

-- ── تحقّق: لا شيء بقي في المنشأة المفرَّغة ─────────────────────────────────
do $$
declare
  v_org  uuid := nullif(current_setting('zaincare.reset_org', true), '')::uuid;
  v_t    text;
  v_n    bigint;
  v_bad  text := '';
  v_off  int;
begin
  if v_org is null then
    raise exception 'لم تُحدَّد المنشأة — لم تُنفَّذ الكتلة الأولى';
  end if;

  foreach v_t in array array['employees', 'inventory_movements', 'inventory_lots',
                             'purchase_orders', 'purchase_invoices', 'goods_receipts',
                             'stock_counts', 'stock_transfers', 'payroll_runs'] loop
    if to_regclass('public.' || v_t) is not null then
      execute format('select count(*) from public.%I where organization_id = $1', v_t) into v_n using v_org;
      if v_n > 0 then v_bad := v_bad || format(' %s=%s', v_t, v_n); end if;
    end if;
  end loop;
  select count(*) into v_n from public.distributors
   where organization_id = v_org and not coalesce(is_dental_lab, false);
  if v_n > 0 then v_bad := v_bad || format(' distributors=%s', v_n); end if;

  if v_bad <> '' then
    raise exception 'بقي في المنشأة:% — تُلغى المعاملة ويعود كلّ شيء', v_bad;
  end if;

  select count(*) into v_off
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not t.tgisinternal and t.tgenabled = 'D';
  if v_off > 0 then
    raise exception 'بقي % حارسًا معطَّلًا — تُلغى المعاملة ويعود كلّ شيء', v_off;
  end if;

  raise notice 'تمّ: المخزون والمشتريات والموردون والموظفون فارغة في هذه المنشأة';
end $$;

commit;
