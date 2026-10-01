-- ============================================================================
-- RESET — تفريغ الماليات التجريبية قبل ربط ZATCA الحقيقيّ
-- ============================================================================
--
-- ⚠ **حذفٌ نهائيّ لا رجعة فيه.** طلب المالك (01/10/2026): «امسح ما فيه من
-- فواتير لنربط الضريبة الحقيقية» — والنطاق: كلّ الماليات التجريبية.
-- خذ نسخة احتياطية من Supabase أوّلًا (Database ← Backups).
--
-- ── ما يُحذف (من المنشأة وحدها) ──────────────────────────────────────────
--   الفواتير      كلّها: الصادرة والمسوّدات والمؤقّتة والإشعارات الدائنة
--                 والمدينة، ببنودها ووثائقها الإلكترونية.
--   السندات       كلّها: القبض والصرف والاسترداد والمصروفات والدفعات المقدّمة،
--                 وتخصيصاتها على الفواتير.
--   اليوميات      وورديات الصناديق — فأوّل يوميةٍ حقيقية رقم 1.
--   ZATCA         سجلّ الإرسال التجريبيّ، وعدّاد جهاز **المحاكاة** يعود ICV = 1.
--   المحفظة       حركات محافظ المرضى، والرصيد يعود صفرًا.
--   القيود        القيود الآلية لما حُذف (وعكوسها). اليدوية والافتتاحية تبقى.
--   الترقيم       تسلسل الفواتير والإشعارات يُحذف؛ ثمّ يُضبط باستمرار Kizen
--                 بالملفّ `ترقيم_الفواتير_من_Kizen_النهائي.sql` (يُنفَّذ بعد هذا).
--   وكلّ ما يتبع ذلك بقيدٍ أجنبيّ إلزاميّ — يُتتبَّع من القاعدة نفسها.
--
-- ── ما يبقى ────────────────────────────────────────────────────────────────
--   المرضى، المواعيد، الزيارات والسجلّ الطبي، الاتفاقيات وعروض أسعارها (يُعاد
--   حساب المفوتَر والمتبقّي فيها بعد حذف فواتيرها)، أرشيف Kizen كاملًا،
--   الخدمات والأسعار، الأطباء والمستخدمون والصلاحيات، الصناديق نفسها،
--   إعدادات الضريبة والربط مع ZATCA، شجرة الحسابات وقيودها اليدوية.
--   مرجعٌ اختياريّ من هذه إلى ما حُذف يُفرَّغ ويبقى الصفّ.
--
-- ── الحُرّاس — يتوقّف قبل حذف صفٍّ واحد إن ──────────────────────────────
--   * وُجدت فاتورةٌ أُبلغت أو اعتُمدت لدى ZATCA في بيئة **الإنتاج**: تلك
--     فاتورةٌ رسمية لا تُحذف؛
--   * أو قاد التتبّع إلى حذف صفٍّ من جدولٍ يجب أن يبقى (مريض، موعد، زيارة،
--     اتفاقية، أرشيف…) — مع اسم الجدول، ولا يُخمَّن.
--
-- منشأةٌ واحدة، وكلّه في معاملةٍ واحدة: أيّ خطأ يُعيد كلّ شيء كما كان.
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
  v_progress   boolean;
  v_bad        text;
  v_has        boolean;
  v_t          text;
  v_agreements uuid[] := '{}';
  v_pkgs       int := 0;

  -- الجذور: كلّ صفوف المنشأة في هذه الجداول
  v_roots text[] := array[
    'sales_invoices', 'financial_vouchers', 'business_days', 'cash_register_shifts',
    'zatca_invoice_submission_logs', 'patient_wallet_transactions'];

  -- ما يجب أن يبقى: إن قاد التتبّع إلى حذف صفٍّ منه توقّف كلّ شيء
  v_protected text[] := array[
    'organizations', 'branches', 'clinics', 'departments', 'warehouses', 'items',
    'price_lists', 'price_list_items', 'doctors', 'organization_memberships', 'organization_roles',
    'patients', 'appointments', 'patient_visits', 'patient_visit_services', 'treatment_sessions',
    'treatment_agreements', 'treatment_agreement_items', 'agreement_quotes',
    'patient_packages', 'patient_package_usages', 'packages',
    'prescriptions', 'lab_orders', 'lab_order_items', 'radiology_orders', 'radiology_order_items',
    'dental_lab_orders', 'medical_reports', 'patient_documents', 'patient_consents',
    'legacy_invoices', 'legacy_invoice_items', 'legacy_receipts', 'legacy_agreements',
    'legacy_appointments', 'legacy_patient_records',
    'chart_of_accounts', 'lookup_values', 'lookup_categories', 'cash_registers',
    'external_clients', 'insurance_companies', 'insurance_contracts', 'employees',
    'zatca_onboarding_settings', 'zatca_device_sequences', 'organization_vat_settings',
    'business_day_settings'];
begin
  -- ══ المنشأة ══════════════════════════════════════════════════════════════
  v_org := nullif(current_setting('zaincare.target_org', true), '')::uuid;
  if v_org is null then
    select id into v_org from public.organizations
     where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
     order by created_at limit 1;
  end if;
  if v_org is null then
    raise exception 'لم تُعثر على منشأة «مجمع أسناني المتميز الطبي»';
  end if;
  perform set_config('zaincare.reset_org', v_org::text, false);

  -- ══ حارس الإنتاج — قبل أيّ شيء ════════════════════════════════════════════
  begin
    select count(*) into v_n
      from public.zatca_invoice_submission_logs l
     where l.organization_id = v_org
       and l.mode = 'production'
       and l.status in ('cleared', 'reported');
  exception when undefined_table or undefined_column then
    v_n := 0;
  end;
  if v_n > 0 then
    raise exception 'توقّف: % فاتورة أُبلغت أو اعتُمدت لدى ZATCA في بيئة الإنتاج — فواتير رسمية لا تُحذف. لم يُحذف شيء.', v_n;
  end if;

  -- ══ ١) الجذور ═════════════════════════════════════════════════════════════
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

  -- الاتفاقيات التي فُوتر منها: يُعاد حساب مفوتَرها ومتبقّيها بعد الحذف
  begin
    select coalesce(array_agg(distinct ai.agreement_id), '{}')
      into v_agreements
      from public.sales_invoice_items sii
      join public.treatment_agreement_items ai on ai.id = sii.agreement_item_id
      join public.sales_invoices si on si.id = sii.invoice_id
     where si.organization_id = v_org;
  exception when undefined_table or undefined_column then
    v_agreements := '{}';
  end;

  -- باقاتٌ بيعت بفواتير تُحذف: تبقى، ويُفرَّغ مرجع فاتورتها (تُذكر)
  begin
    select count(*) into v_pkgs
      from public.patient_packages pp
      join public.sales_invoices si on si.id = pp.sales_invoice_id
     where si.organization_id = v_org;
  exception when undefined_table or undefined_column then
    v_pkgs := 0;
  end;

  -- ══ ٢) تتبّع ما يتبع — من القيود الأجنبية في القاعدة ══════════════════════
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
    -- جدول ربطٍ بلا معرّف من المحميّة: يُحذف بمرجعه — يُحسب إن كان فيه ما يُحذف
    for v_rel in select * from _nul where parent like '!%' and tbl = any(v_protected) loop
      execute format('select count(*) from public.%I where %I::text in (select id from _del where tbl = %L)',
                     v_rel.tbl, v_rel.col, substr(v_rel.parent, 2)) into v_n;
      if v_n > 0 then
        v_bad := coalesce(v_bad || '، ', '') || format('%s (%s صفًّا)', v_rel.tbl, v_n);
      end if;
    end loop;
  end if;
  if v_bad is not null then
    raise exception 'توقّف قبل أيّ حذف: التتبّع يقود إلى حذف صفوف من جداول يجب أن تبقى: %. أرسل هذه الرسالة لمراجعتها.', v_bad;
  end if;

  raise notice 'يُفرَّغ من المنشأة %:', v_org;
  for v_rel in select tbl, count(*) n from _del group by tbl order by tbl loop
    raise notice '  % — % صفًّا', v_rel.tbl, v_rel.n;
  end loop;

  -- ══ ٤) تعطيل حُرّاس المنع داخل هذه المعاملة وحدها ══════════════════════════
  -- حُرّاس منع حذف الفواتير الصادرة والسندات صحيحة أثناء التشغيل، والتفريغ
  -- ليس تعديل سطر. حُرّاس المفاتيح الأجنبية لا تُمَسّ، فالترتيب يبقى محروسًا.
  -- والتعطيل DDL داخل المعاملة: أيّ تعثّر يُعيده بـ rollback.
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

  for v_rel in select * from _nul where parent like '!%' loop
    execute format(
      'delete from public.%I where %I::text in (select id from _del where tbl = %L)',
      v_rel.tbl, v_rel.col, substr(v_rel.parent, 2));
  end loop;

  -- ══ ٦) الحذف — من الابن إلى الأب، بمحاولاتٍ متتالية ═════════════════════
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

  -- ══ ٧) المحفظة وZATCA والترقيم ════════════════════════════════════════════
  begin
    update public.patient_wallets set balance = 0, updated_at = now()
     where organization_id = v_org and balance <> 0;
    get diagnostics v_n = row_count;
    if v_n > 0 then raise notice 'أُعيد رصيد % محفظة إلى صفر', v_n; end if;
  exception when undefined_table or undefined_column then null;
  end;

  -- عدّاد جهاز **المحاكاة** وحده يعود إلى أوّله (ICV = 1 والـPIH الابتدائيّ).
  -- جهاز الإنتاج لا يُمسّ: سلسلته عند الهيئة.
  begin
    update public.zatca_device_sequences s
       set next_icv = 1,
           last_pih = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
           reservation_token = null, reservation_expires_at = null
      from public.zatca_onboarding_settings o
     where o.id = s.onboarding_id and o.organization_id = v_org and o.mode = 'simulation';
  exception when undefined_table or undefined_column then
    raise notice 'تُخطّي عدّاد ZATCA: الجدول أو أعمدته غير موجودة';
  end;

  -- تسلسل الفواتير والإشعارات: يُضبط بعدها باستمرار Kizen (ملفّ الترقيم)
  delete from public.document_number_sequences
   where organization_id = v_org and document_kind in ('invoice', 'credit_note', 'debit_note');

  -- ══ ٨) القيود الآلية لما حُذف (وعكوسها) ═══════════════════════════════════
  begin
    create temp table _je (id uuid primary key) on commit drop;
    insert into _je
    select e.id
      from public.journal_entries e
     where e.organization_id = v_org
       and ((e.reference_type = 'sales_invoice'
             and not exists (select 1 from public.sales_invoices x where x.id = e.reference_id))
         or (e.reference_type = 'financial_voucher'
             and not exists (select 1 from public.financial_vouchers x where x.id = e.reference_id))
         or (e.reference_type = 'business_day'
             and not exists (select 1 from public.business_days x where x.id = e.reference_id)));
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
    raise notice 'حُذف % قيدًا آليًّا لفواتير وسندات ويوميات تجريبية', v_n;
  exception when undefined_table or undefined_column then
    raise notice 'تُخطّي قيود اليومية: الجداول أو الأعمدة غير موجودة';
  end;

  -- ══ ٩) الترقيم الداخليّ — لما فرغ جدوله في كلّ المنشآت ═══════════════════
  for v_rel in
    select s.oid::regclass::text as seq, t.relname as tbl, a.attname as col
      from pg_class s
      join pg_depend d     on d.objid = s.oid and d.classid = 'pg_class'::regclass
                          and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
      join pg_class t      on t.oid = d.refobjid
      join pg_namespace n  on n.oid = t.relnamespace
      join pg_attribute a  on a.attrelid = t.oid and a.attnum = d.refobjsubid
     where s.relkind = 'S' and n.nspname = 'public'
       and t.relname in (select distinct tbl from _del)
  loop
    execute format('select exists (select 1 from public.%I)', v_rel.tbl) into v_has;
    if not v_has then
      perform setval(v_rel.seq, 1, false);
      raise notice 'الترقيم يبدأ من 1: %.%', v_rel.tbl, v_rel.col;
    end if;
  end loop;

  -- ══ ١٠) إعادة الحُرّاس ════════════════════════════════════════════════════
  for v_rel in
    select distinct c.relname as tbl
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I enable trigger user', v_rel.tbl);
  end loop;

  -- ══ ١١) الاتفاقيات: المفوتَر والمتبقّي من جديد بلا الفواتير المحذوفة ═══════
  if array_length(v_agreements, 1) > 0 then
    for v_rel in select unnest(v_agreements) as id loop
      perform public.app_agreement_refresh(v_rel.id);
    end loop;
    raise notice 'أُعيد حساب % اتفاقية فُوتر منها', array_length(v_agreements, 1);
  end if;

  if v_pkgs > 0 then
    raise notice 'تنبيه: % باقة بيعت بفاتورة تجريبية — بقيت عند مرضاها بلا فاتورة. راجعها في «الباقات».', v_pkgs;
  end if;
end $$;

-- ── تحقّق: لا فاتورة ولا سند ولا يومية في المنشأة، ولا حارسٌ معطَّل ───────
do $$
declare
  v_org  uuid := nullif(current_setting('zaincare.reset_org', true), '')::uuid;
  v_i    bigint;
  v_v    bigint;
  v_d    bigint;
  v_off  int;
begin
  if v_org is null then
    raise exception 'لم تُحدَّد المنشأة — لم تُنفَّذ الكتلة الأولى';
  end if;
  select count(*) into v_i from public.sales_invoices     where organization_id = v_org;
  select count(*) into v_v from public.financial_vouchers where organization_id = v_org;
  select count(*) into v_d from public.business_days      where organization_id = v_org;
  if v_i + v_v + v_d > 0 then
    raise exception 'بقي في المنشأة: % فاتورة، % سندًا، % يومية — تُلغى المعاملة ويعود كلّ شيء', v_i, v_v, v_d;
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

  raise notice 'تمّ: لا فواتير ولا سندات ولا يوميات في المنشأة. التالي: ترقيم_الفواتير_من_Kizen_النهائي.sql';
end $$;

commit;

-- ── ما بقي: المرضى والاتفاقيات الحيّة كما هي ─────────────────────────────────
select
  (select count(*) from public.patients p
    where p.organization_id = nullif(current_setting('zaincare.reset_org', true), '')::uuid)            as "المرضى",
  (select count(*) from public.treatment_agreements a
    where a.organization_id = nullif(current_setting('zaincare.reset_org', true), '')::uuid
      and not a.is_disabled)                                                                              as "اتفاقيات نشطة",
  (select coalesce(sum(a.remaining_amount), 0) from public.treatment_agreements a
    where a.organization_id = nullif(current_setting('zaincare.reset_org', true), '')::uuid
      and not a.is_disabled)                                                                              as "متبقّيها",
  (select count(*) from public.legacy_invoices l
    where l.organization_id = nullif(current_setting('zaincare.reset_org', true), '')::uuid)            as "أرشيف Kizen: فواتير";
