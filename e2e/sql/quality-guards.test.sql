-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات الجودة وسلامة المرضى والمؤشّرات — 0106
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/quality-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS.**
--
-- الخطر الذي تحرسه هذه الفحوص: مؤشّرٌ يُكتب باليد فيبدو قياسًا، وبلاغُ سلامة
-- يُغلق فارغًا فيبدو تحقيقًا، ونسبةٌ تُحسب صفرًا حين لا مقام لها فتبدو إنجازًا.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_nurse   uuid;
  v_branch  uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_inc     uuid;
  v_ind     uuid;
  v_meas    uuid;
  v_num     numeric;
  v_int     integer;
  v_txt     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'q-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'q-nurse@test.local')
    returning id into v_nurse;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار الجودة', 'medical_center', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_nurse, 'nurse', true);
  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','Q1','name','عيادة','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب')
    returning id into v_doctor;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض')
    returning id into v_patient;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) المنشأة الجديدة تُولد بمؤشّراتها القياسية
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from quality_indicators where organization_id = v_org;
  if v_int < 12 then
    raise exception 'فشل: المنشأة الجديدة بلا مؤشّرات جودة (%)', v_int;
  end if;
  raise notice '✅ ١) المنشأة الجديدة تُبذر مؤشّراتها تلقائيًّا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) البلاغ يحتاج وصفًا، ولا يكون في المستقبل
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_report_quality_incident(v_org, 'medication', 'minor', '   ');
    raise exception 'فشل: قُبل بلاغ بلا وصف';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%وصف الحادثة مطلوب%' then raise; end if;
  end;
  begin
    perform app_report_quality_incident(v_org, 'fall', 'minor', 'سقوط',
                                        v_branch, null, now() + interval '2 days');
    raise exception 'فشل: قُبل بلاغ عن حادثة مستقبلية';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%في المستقبل%' then raise; end if;
  end;
  raise notice '✅ ٢) البلاغ يحتاج وصفًا ولا يُقبل في المستقبل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) **الممرّضة تُبلّغ**: نظام سلامة لا يُبلّغ فيه إلا المدراء لا يرى شيئًا
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_nurse::text, true);
  v_inc := app_report_quality_incident(
             v_org, 'medication', 'moderate', 'صُرف دواء بجرعة مضاعفة',
             v_branch, v_patient, now() - interval '2 hours', 'جناح 3',
             'أُوقف الدواء وأُبلغ الطبيب');
  if v_inc is null then raise exception 'فشل: لم تستطع الممرّضة رفع بلاغ'; end if;
  if (select incident_number from quality_incidents where id = v_inc) is null then
    raise exception 'فشل: البلاغ بلا رقم متسلسل';
  end if;
  -- والمحقّقون يُنبَّهون
  if not exists (select 1 from notifications
                  where organization_id = v_org and event_key = 'quality_incident') then
    raise exception 'فشل: بلاغ السلامة لم يُنبّه المحقّقين';
  end if;
  raise notice '✅ ٣) كل عامل يستطيع رفع بلاغ، والمحقّقون يُنبَّهون فورًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) البلاغ المجهول لا يُسجَّل مُبلِّغه أصلًا
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_anon uuid;
  begin
    v_anon := app_report_quality_incident(
                v_org, 'communication', 'near_miss', 'خطأ في تسليم المناوبة',
                v_branch, null, now() - interval '1 hour', null, null, true);
    if (select reported_by from quality_incidents where id = v_anon) is not null then
      raise exception 'فشل: حُفظ معرّف المُبلِّغ رغم اختياره المجهولية';
    end if;
  end;
  raise notice '✅ ٤) البلاغ المجهول لا يحفظ هوية مُبلِّغه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الممرّضة لا تُغلق بلاغًا، و**لا إغلاق بلا سببٍ جذريّ وإجراء**
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_close_quality_incident(v_inc, 'سبب', 'إجراء');
    raise exception 'فشل: أغلقت الممرّضة بلاغًا بلا صلاحية تحقيق';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%quality.investigate%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    perform app_close_quality_incident(v_inc, '   ', 'إجراء');
    raise exception 'فشل: أُغلق بلاغ بلا سبب جذريّ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%السبب الجذريّ مطلوب%' then raise; end if;
  end;
  begin
    perform app_close_quality_incident(v_inc, 'خطأ في قراءة الوصفة', '  ');
    raise exception 'فشل: أُغلق بلاغ بلا إجراء تصحيحيّ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%الإجراء التصحيحيّ مطلوب%' then raise; end if;
  end;

  perform app_close_quality_incident(
    v_inc, 'تشابه أسماء الأدوية', 'فصل الدوائين على الرف', 'إضافة تنبيه في نظام الصرف');
  if (select status from quality_incidents where id = v_inc) <> 'closed' then
    raise exception 'فشل: لم يُغلق البلاغ';
  end if;
  begin
    perform app_close_quality_incident(v_inc, 'سبب آخر', 'إجراء آخر');
    raise exception 'فشل: أُغلق البلاغ مرّتين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%مغلق سلفًا%' then raise; end if;
  end;
  raise notice '✅ ٥) الإغلاق يحتاج صلاحية وسببًا جذريًّا وإجراءً، ولا يتكرّر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) البلاغ لا يُحذف
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    delete from quality_incidents where id = v_inc;
    raise exception 'فشل: حُذف بلاغ سلامة';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لا يُحذف%' then raise; end if;
  end;
  raise notice '✅ ٦) بلاغ السلامة لا يُحذف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) **المؤشّر المحسوب لا يُدخَل يدويًّا، والمجهول لا يُحسب صفرًا**
  -- ═════════════════════════════════════════════════════════════════════════
  select id into v_ind from quality_indicators
   where organization_id = v_org and metric_key = 'incident_closure_rate';

  begin
    perform app_measure_quality_indicator(v_ind, current_date - 30, current_date, 88);
    raise exception 'فشل: أُدخلت قيمة يدويّة لمؤشّر محسوب آليًّا';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%محسوب آليًّا%' then raise; end if;
  end;

  begin
    perform app_compute_quality_metric(v_org, 'مؤشّر لا وجود له',
                                       current_date - 30, current_date);
    raise exception 'فشل: مؤشّر مجهول حُسب بدل أن يُرفض';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%غير معروف%' then raise; end if;
  end;
  raise notice '✅ ٧) المحسوب لا يُدخَل يدويًّا، والمجهول يُرفض ولا يُحسب صفرًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) القياس من البيانات الحقيقية: بلاغان أحدهما مغلق ⇒ 50%
  -- ═════════════════════════════════════════════════════════════════════════
  v_meas := app_measure_quality_indicator(v_ind, current_date - 7, current_date);
  select value, numerator, denominator into v_num, v_int, v_txt
    from (select value, numerator::int, denominator::text
            from quality_measurements where id = v_meas) t(value, numerator, denominator);
  if v_num <> 50.00 then
    raise exception 'فشل: نسبة إغلاق البلاغات % بدل 50', v_num;
  end if;
  if v_int <> 1 then
    raise exception 'فشل: البسط % بدل 1', v_int;
  end if;
  raise notice '✅ ٨) المؤشّر يُحسب من البلاغات الفعلية بالبسط والمقام';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) **لا مقام ⇒ لا نسبة**: القيمة تبقى فارغة ولا تُخترع صفرًا
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_ind2 uuid; v_meas2 uuid;
  begin
    select id into v_ind2 from quality_indicators
     where organization_id = v_org and metric_key = 'no_show_rate';
    v_meas2 := app_measure_quality_indicator(v_ind2, current_date - 7, current_date);
    if (select value from quality_measurements where id = v_meas2) is not null then
      raise exception 'فشل: نسبة عدم الحضور حُسبت رغم غياب أيّ موعد';
    end if;
    if (select status from v_quality_scorecard where indicator_id = v_ind2) <> 'unknown' then
      raise exception 'فشل: مؤشّر بلا قيمة ظهر بحالة معروفة';
    end if;
  end;
  raise notice '✅ ٩) بلا مقام لا نسبة — والحالة «غير معروف» لا «مطابق للهدف»';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) قياس فترة لم تنتهِ مرفوض، والقياس لا يتكرّر متناقضًا
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_measure_quality_indicator(v_ind, current_date - 3, current_date + 5);
    raise exception 'فشل: قِيست فترة لم تنتهِ';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لم تنتهِ%' then raise; end if;
  end;

  select count(*) into v_int from quality_measurements
   where indicator_id = v_ind and period_start = current_date - 7;
  perform app_measure_quality_indicator(v_ind, current_date - 7, current_date);
  select count(*) into v_num from quality_measurements
   where indicator_id = v_ind and period_start = current_date - 7;
  if v_num <> v_int then
    raise exception 'فشل: تكرار القياس أنشأ صفًّا ثانيًا للفترة نفسها';
  end if;
  raise notice '✅ ١٠) الفترة غير المنتهية لا تُقاس، والقياس يُحدَّث ولا يتكرّر';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) المؤشّر اليدويّ يحتاج مصدرًا مكتوبًا
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_manual uuid; v_m uuid;
  begin
    insert into quality_indicators (organization_id, metric_key, name_ar, domain, unit,
                                    higher_is_better, target_value, is_manual)
      values (v_org, 'patient_satisfaction', 'رضا المرضى', 'experience', 'percent',
              true, 90, true)
      returning id into v_manual;

    begin
      perform app_measure_quality_indicator(v_manual, current_date - 30, current_date);
      raise exception 'فشل: مؤشّر يدويّ قُبل بلا قيمة';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%القيمة مطلوبة%' then raise; end if;
    end;
    begin
      perform app_measure_quality_indicator(v_manual, current_date - 30, current_date, 92);
      raise exception 'فشل: رقم يدويّ قُبل بلا مصدر';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%مصدر الرقم مطلوب%' then raise; end if;
    end;

    v_m := app_measure_quality_indicator(v_manual, current_date - 30, current_date, 92,
                                         'مسح رضا 120 مريضًا — أكتوبر');
    if not (select is_manual from quality_measurements where id = v_m) then
      raise exception 'فشل: القياس اليدويّ لم يُعلَّم كذلك';
    end if;
  end;
  raise notice '✅ ١١) المؤشّر اليدويّ يحتاج قيمةً ومصدرًا، ويُعلَّم أنه يدويّ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) حالة الهدف تحترم اتجاه المؤشّر
  -- ═════════════════════════════════════════════════════════════════════════
  -- إغلاق البلاغات 50% والهدف 90% وارتفاعه مطلوب ⇒ خارج الهدف
  if (select status from v_quality_scorecard where indicator_id = v_ind) <> 'off_target' then
    raise exception 'فشل: 50%% أمام هدف 90%% صاعد لم تُحسب خارج الهدف';
  end if;
  -- رضا المرضى 92% والهدف 90% صاعد ⇒ مطابق
  if (select status from v_quality_scorecard
       where organization_id = v_org and metric_key = 'patient_satisfaction') <> 'on_target' then
    raise exception 'فشل: 92%% أمام هدف 90%% صاعد لم تُحسب مطابقة';
  end if;
  raise notice '✅ ١٢) حالة الهدف تحترم اتجاه المؤشّر صعودًا ونزولًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) عزل المنشآت
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_org2 uuid; v_owner2 uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'q-other@test.local')
      returning id into v_owner2;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'clinic', v_owner2) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_owner2::text, true);
    begin
      perform app_report_quality_incident(v_org, 'other', 'minor', 'بلاغ من خارج المنشأة');
      raise exception 'فشل: رفع غريبٌ بلاغًا في منشأة ليست له';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%quality.report%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ١٣) عزل المنشآت قائم على الجودة';

  raise notice '——— كل فحوص الجودة نجحت ———';
end $$;

rollback;
