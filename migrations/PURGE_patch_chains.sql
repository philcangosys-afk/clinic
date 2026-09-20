-- ############################################################################
-- ##  ترقيعُ `app_purge_patients` في مكانها — بلا لصق ملفٍّ كامل              ##
-- ############################################################################
--
-- ثلاث سلاسل طُويت درجةً واحدة فصارت تسأل عن عمودٍ لا وجود له:
--   • `lab_order_items` يصل إلى المريض عبر `lab_orders` لا مباشرةً
--   • `radiology_order_items` عبر `radiology_orders`
--   • `payroll_run_items` لا يصل أصلًا — رواتب الموظفين ليست من ملفّ المريض،
--     فيبقى صفّ الراتب ويُنزع منه الربط بالسند المحذوف لا غير.
--
-- **ولماذا ترقيعٌ لا إعادةُ لصق؟** لأنّ في القاعدة أكثر من نسخة من الدالّة
-- (بوسيطين وبثلاثة)، و`create or replace` تستبدل التي تطابق التوقيع وحدها
-- فتبقى الأخرى قديمة. هذا يمرّ على كلّ نسخةٍ موجودة مهما كان توقيعها.
--
-- ويرفض المضيّ إن لم يجد ما يُصلحه: مرساةٌ لا تُطابق تُوقِف العملية برسالةٍ
-- تسمّي النسخة، فلا تُستبدَل دالّةٌ بنصفِ إصلاح.
--
-- وتكراره لا يضرّ: النسخة المُصلَحة تُتخطّى ويُقال كم تُرك.
-- ############################################################################

do $patch$
declare
  v_oids oid[];
  v_oid  oid;
  v_src  text;
  v_new  text;
  v_tmp  text;
  v_done int := 0;
  v_skip int := 0;
  a1 text; r1 text;
  a2 text; r2 text;
  a3 text; r3 text;
begin
  a1 := '    delete from payroll_item_details where payroll_run_item_id in (select id from payroll_run_items where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || ''payroll_item_details''::text; v_counts := v_counts || v_n; end if;
    delete from payroll_run_items where paid_voucher_id in (select id from financial_vouchers where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || ''payroll_run_items''::text; v_counts := v_counts || v_n; end if;';

  r1 := '    -- رواتب الموظفين ليست من ملفّ المريض: لا عمود patient_id في
    -- payroll_run_items أصلًا. فيبقى صفّ الراتب ويُنزع الربط بالسند المحذوف.
    update payroll_run_items set paid_voucher_id = null
     where paid_voucher_id in (select id from financial_vouchers where patient_id = any(v_ids));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_names := v_names || ''payroll_run_items.paid_voucher_id (تُفرَّغ)''::text; v_counts := v_counts || v_n; end if;';

  a2 := 'delete from lab_result_amendments where lab_order_item_id in (select id from lab_order_items where patient_id = any(v_ids));';
  r2 := 'delete from lab_result_amendments where lab_order_item_id in (select id from lab_order_items where lab_order_id in (select id from lab_orders where patient_id = any(v_ids)));';

  a3 := 'delete from radiology_images where radiology_order_item_id in (select id from radiology_order_items where patient_id = any(v_ids));';
  r3 := 'delete from radiology_images where radiology_order_item_id in (select id from radiology_order_items where radiology_order_id in (select id from radiology_orders where patient_id = any(v_ids)));';

  -- اللصق عبر الحافظة يُدخل chr(13) على النصوص أعلاه دون مصدر الدالّة
  -- المخزَّن — فلا يتطابقان إلّا بتجريد الطرفين. (هذا بالضبط ما أفشل 0167
  -- عندك أوّل مرّة.)
  a1 := replace(a1, chr(13), ''); r1 := replace(r1, chr(13), '');
  a2 := replace(a2, chr(13), ''); r2 := replace(r2, chr(13), '');
  a3 := replace(a3, chr(13), ''); r3 := replace(r3, chr(13), '');

  select coalesce(array_agg(p.oid), '{}') into v_oids
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_purge_patients';

  if coalesce(array_length(v_oids, 1), 0) = 0 then
    raise exception 'لا توجد دالّة app_purge_patients — نفِّذ PURGE_all_patients.sql أوّلًا';
  end if;

  foreach v_oid in array v_oids loop
    v_src := replace(pg_get_functiondef(v_oid), chr(13), '');

    if position('payroll_run_items where patient_id' in v_src) = 0
       and position(a2 in v_src) = 0
       and position(a3 in v_src) = 0 then
      v_skip := v_skip + 1;
      continue;
    end if;

    v_new := v_src;
    v_tmp := v_new; v_new := replace(v_new, a1, r1);
    if v_new = v_tmp then raise exception 'المرساة ١ لم تُطابق في %', v_oid::regprocedure; end if;
    v_tmp := v_new; v_new := replace(v_new, a2, r2);
    if v_new = v_tmp then raise exception 'المرساة ٢ لم تُطابق في %', v_oid::regprocedure; end if;
    v_tmp := v_new; v_new := replace(v_new, a3, r3);
    if v_new = v_tmp then raise exception 'المرساة ٣ لم تُطابق في %', v_oid::regprocedure; end if;

    execute v_new;
    v_done := v_done + 1;
  end loop;

  raise notice 'رُقِّعت % نسخة، وتُركت % نسخة صحيحة أصلًا', v_done, v_skip;
end
$patch$;
