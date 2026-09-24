-- ============================================================================
-- DELETE — حذف منشأة كاملة من القاعدة
-- ============================================================================
--
-- ⚠ **حذفٌ نهائيّ لا رجعة فيه**: المنشأة وكلّ ما تحتها — مرضاها وفواتيرها
-- وسنداتها وأطبّاؤها وموظّفوها وخدماتها وفروعها وعضويّاتها وإعداداتها.
-- خذ نسخة احتياطية من Supabase أوّلًا (Database ← Backups).
--
-- للمنشآت التجريبية قبل التشغيل الحقيقيّ. ولا يُحذف بها **حساب** المستخدم من
-- Supabase Auth: يبقى الحساب وتذهب عضويّته — فمن كان عضوًا فيها وحدها يبقى
-- بلا منشأة، ومن كان عضوًا في غيرها لا يتأثّر.
--
-- ── الاستعمال ─────────────────────────────────────────────────────────────
-- في نافذة SQL نفسها، قبل تنفيذ الملفّ:
--
--   select set_config('zaincare.delete_org', '<معرّف المنشأة>', false);
--
-- ثمّ نفّذ هذا الملفّ. وبدون المعرّف يرفض التنفيذ — لا تخمين لمنشأة تُحذف.
--
-- ── كيف يحذف ──────────────────────────────────────────────────────────────
-- لا قائمة جداول مكتوبة بيد: القاعدة تُسأل عن كلّ جدولٍ فيه `organization_id`،
-- وعن أبناء تلك الجداول بالمفاتيح الأجنبية. ثمّ تُعاد المحاولة دورةً بعد دورة:
-- ما مَنَعه مفتاحٌ أجنبيّ في دورة يُحذف في التالية بعد أبنائه. فإن انتهت
-- الدورات وبقي صفّ، رُفع خطأ وأُلغيت المعاملة كاملةً — لا منشأة نصف محذوفة.
--
-- **حارسٌ على الاسم:** يرفض حذف «مجمع أسناني المتميز الطبي» أو «مجمع زين
-- الطبي» — المنشأة العاملة لا تُحذف بملفٍّ يُنفَّذ بالخطأ.
-- ============================================================================

-- ✏ معرّف المنشأة المراد حذفها — غيّره إن أردت منشأةً أخرى:
select set_config('zaincare.delete_org', 'c527b7ee-c7a2-406a-945f-e012d43d61c6', false);

begin;

do $$
declare
  v_org     uuid := nullif(current_setting('zaincare.delete_org', true), '')::uuid;
  v_name    text;
  v_total   bigint;
  v_rel     record;
  v_fk      record;
  v_pass    int;
  v_deleted bigint;
  v_n       bigint;
  v_left    text;
  v_stmt    text;
begin
  if v_org is null then
    raise exception 'حدِّد المنشأة أوّلًا: select set_config(''zaincare.delete_org'', ''<المعرّف>'', false);';
  end if;

  select name into v_name from public.organizations where id = v_org;
  if v_name is null then
    raise exception 'لا توجد منشأة بهذا المعرّف: %', v_org;
  end if;
  if v_name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي') then
    raise exception 'المنشأة «%» هي المنشأة العاملة — لا تُحذف من هنا', v_name;
  end if;
  if (select count(*) from public.organizations) < 2 then
    raise exception 'هذه المنشأة الوحيدة في القاعدة — حذفها يُفرغ النظام من كلّ شيء';
  end if;

  raise notice 'تُحذف المنشأة: % (%)', v_name, v_org;

  -- ══ ١) تعطيل حُرّاس المنع داخل المعاملة ═══════════════════════════════════
  -- كما في `RESET_patients_and_invoices.sql`: الحُرّاس تمنع المساس بما صدر،
  -- وهي صحيحة، لكنّ المنشأة كلّها تذهب فلا سطرَ يُيتَّم ولا مجموعَ يختلّ.
  -- والتعطيل أمر DDL يخضع للمعاملة: `rollback` يعيده وحده.
  for v_rel in
    select distinct c.relname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I disable trigger user', v_rel.relname);
  end loop;

  -- ══ ١٫٥) أبناءٌ معروفون لا `organization_id` لهم ═════════════════════════
  -- الدورات أدناه تكتشف الأبناء بالمفاتيح الأجنبية. وهذه القائمة الصريحة
  -- احتياطٌ لجدولٍ سقط مفتاحه الأجنبيّ في نسخةٍ من القاعدة: بلا مفتاح لا
  -- يكتشفه الاكتشاف الآليّ، ويبقى صفًّا يتيمًا بعد ذهاب أبيه.
  foreach v_stmt in array array[
    $stmt$delete from public.sales_invoice_items where invoice_id in (select id from public.sales_invoices where organization_id = $1)$stmt$,
    $stmt$delete from public.voucher_invoice_allocations where voucher_id in (select id from public.financial_vouchers where organization_id = $1)$stmt$,
    $stmt$delete from public.bank_reconciliation_lines where voucher_id in (select id from public.financial_vouchers where organization_id = $1)$stmt$,
    $stmt$delete from public.einvoice_documents where sales_invoice_id in (select id from public.sales_invoices where organization_id = $1)$stmt$,
    $stmt$delete from public.treatment_agreement_items where agreement_id in (select id from public.treatment_agreements where organization_id = $1)$stmt$,
    $stmt$delete from public.patient_visit_services where visit_id in (select id from public.patient_visits where organization_id = $1)$stmt$,
    $stmt$delete from public.prescription_items where prescription_id in (select id from public.prescriptions where organization_id = $1)$stmt$,
    $stmt$delete from public.purchase_invoice_items where purchase_invoice_id in (select id from public.purchase_invoices where organization_id = $1)$stmt$,
    $stmt$delete from public.purchase_order_items where purchase_order_id in (select id from public.purchase_orders where organization_id = $1)$stmt$
  ] loop
    begin
      execute v_stmt using v_org;
    exception when undefined_table or undefined_column or foreign_key_violation then
      null;
    end;
  end loop;

  -- ══ ٢) دوراتُ حذف: الابن يسقط فيُفسح للأب ═════════════════════════════════
  for v_pass in 1 .. 30 loop
    v_deleted := 0;

    -- (أ) أبناءُ جداول المنشأة ممّن لا `organization_id` لهم: يُحذفون
    --     بمفاتيحهم الأجنبية. مفتاحٌ مركّب يُترك للدورة التالية عبر الأب.
    for v_fk in
      select ch.relname            as child,
             att.attname           as child_col,
             pr.relname            as parent,
             patt.attname          as parent_col
        from pg_constraint k
        join pg_class ch  on ch.oid = k.conrelid
        join pg_class pr  on pr.oid = k.confrelid
        join pg_namespace n1 on n1.oid = ch.relnamespace
        join pg_namespace n2 on n2.oid = pr.relnamespace
        join pg_attribute att  on att.attrelid = k.conrelid  and att.attnum  = k.conkey[1]
        join pg_attribute patt on patt.attrelid = k.confrelid and patt.attnum = k.confkey[1]
       where k.contype = 'f'
         and n1.nspname = 'public' and n2.nspname = 'public'
         and array_length(k.conkey, 1) = 1
         and ch.relname <> pr.relname
         and exists (
           select 1 from pg_attribute a
            where a.attrelid = pr.oid and a.attname = 'organization_id' and a.attnum > 0 and not a.attisdropped)
         and not exists (
           select 1 from pg_attribute a
            where a.attrelid = ch.oid and a.attname = 'organization_id' and a.attnum > 0 and not a.attisdropped)
    loop
      begin
        execute format(
          'delete from public.%I where %I in (select %I from public.%I where organization_id = $1)',
          v_fk.child, v_fk.child_col, v_fk.parent_col, v_fk.parent) using v_org;
        get diagnostics v_n = row_count;
        v_deleted := v_deleted + v_n;
      exception
        when foreign_key_violation or check_violation or not_null_violation
          or restrict_violation or undefined_column or undefined_table then
        null;   -- الدورة التالية، بعد أن يسقط أبناؤه
      end;
    end loop;

    -- (ب) كلّ جدولٍ فيه `organization_id` — عدا `organizations` نفسه
    for v_rel in
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
       where n.nspname = 'public' and c.relkind = 'r'
         and a.attname = 'organization_id' and a.attnum > 0 and not a.attisdropped
         and c.relname <> 'organizations'
    loop
      begin
        execute format('delete from public.%I where organization_id = $1', v_rel.relname) using v_org;
        get diagnostics v_n = row_count;
        v_deleted := v_deleted + v_n;
      exception
        -- **ليس المفتاح الأجنبيّ وحده ما يؤجّل الحذف:** مفتاحٌ بـ`on delete
        -- set null` يُفرِغ عمودًا في الابن فيصطدم بقيد `check` عليه — كفاتورةٍ
        -- تشترط مريضًا أو اسم عميلٍ خارجيّ. فيُؤجَّل الأب إلى دورةٍ بعد سقوط
        -- ابنه، وما بقي بعد الدورات كلّها يكشفه التحقّق أدناه.
        when foreign_key_violation or check_violation or not_null_violation
          or restrict_violation then
        null;   -- ابنٌ لم يسقط بعد
      end;
    end loop;

    exit when v_deleted = 0;
  end loop;

  -- ══ ٣) ما بقي يُكشف بالاسم، ولا تُغلق معاملةٌ على نصف حذف ═════════════════
  v_left := null;
  v_total := 0;
  for v_rel in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public' and c.relkind = 'r'
       and a.attname = 'organization_id' and a.attnum > 0 and not a.attisdropped
       and c.relname <> 'organizations'
  loop
    execute format('select count(*) from public.%I where organization_id = $1', v_rel.relname)
      using v_org into v_n;
    if v_n > 0 then
      v_total := v_total + v_n;
      v_left := coalesce(v_left || ', ', '') || format('%s(%s)', v_rel.relname, v_n);
    end if;
  end loop;

  if v_total > 0 then
    raise exception 'بقي % صفًّا للمنشأة: % — أُلغيت المعاملة ولم يُحذف شيء', v_total, v_left;
  end if;

  delete from public.organizations where id = v_org;

  -- ══ ٤) إعادة الحُرّاس ═════════════════════════════════════════════════════
  for v_rel in
    select distinct c.relname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I enable trigger user', v_rel.relname);
  end loop;

  raise notice 'حُذفت المنشأة «%» وكلّ ما تحتها', v_name;
end $$;

-- تحقّق: لم تبقَ المنشأة، ولا حارسٌ معطَّل
do $$
declare v_org uuid := nullif(current_setting('zaincare.delete_org', true), '')::uuid; v_off int;
begin
  if exists (select 1 from public.organizations where id = v_org) then
    raise exception 'المنشأة ما زالت موجودة — تُلغى المعاملة';
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
end $$;

commit;
