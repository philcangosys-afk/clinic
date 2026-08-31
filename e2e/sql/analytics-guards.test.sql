-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات التحليلات والاتجاهات — 0111
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/analytics-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS.**
--
-- الخطر الذي تحرسه هذه الفحوص: رقمٌ يبدو تحسّنًا وهو خطأ حساب — نسبة تغيّر
-- على أساس صفر، أو فترة مقارنة بطولٍ مختلف، أو إيرادٌ يعدّ الفواتير الملغاة.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_branch  uuid;
  v_clinic  uuid;
  v_doctor  uuid;
  v_patient uuid;
  v_num     numeric;
  v_int     integer;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'an-owner@test.local')
    returning id into v_owner;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار التحليلات', 'clinic', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                'code','AN1','name','عيادة','branch_id', v_branch));
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب')
    returning id into v_doctor;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض')
    returning id into v_patient;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) السلسلة اليومية تُجمّع اليوم الواحد في صفٍّ واحد
  -- ═════════════════════════════════════════════════════════════════════════
  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            scheduled_start, scheduled_end, status, created_by)
    values
      (v_org, v_branch, v_clinic, v_doctor, v_patient,
       (current_date - 1)::timestamptz + interval '9 hours',
       (current_date - 1)::timestamptz + interval '9 hours 30 minutes', 'no_show', v_owner),
      (v_org, v_branch, v_clinic, v_doctor, v_patient,
       (current_date - 1)::timestamptz + interval '10 hours',
       (current_date - 1)::timestamptz + interval '10 hours 30 minutes', 'scheduled', v_owner),
      (v_org, v_branch, v_clinic, v_doctor, v_patient,
       (current_date - 1)::timestamptz + interval '11 hours',
       (current_date - 1)::timestamptz + interval '11 hours 30 minutes', 'scheduled', v_owner);

  -- المنظور **لكل فرع**: المريض بلا فرع يُنشئ صفًّا بفرعٍ فارغ في اليوم
  -- نفسه، فالقراءة الصحيحة جمعُ صفوف اليوم لا أخذ أوّلها. (هكذا تفعل الشاشة.)
  select count(*) into v_int from v_analytics_daily
   where organization_id = v_org and report_date = current_date - 1
     and branch_id = v_branch;
  if v_int <> 1 then
    raise exception 'فشل: الفرع الواحد في اليوم الواحد له % صفًّا بدل صفّ واحد', v_int;
  end if;

  select sum(appointments_total), sum(no_shows) into v_int, v_num from v_analytics_daily
   where organization_id = v_org and report_date = current_date - 1;
  if v_int <> 3 then
    raise exception 'فشل: عدد مواعيد اليوم % بدل 3', v_int;
  end if;
  if v_num <> 1 then
    raise exception 'فشل: عدد عدم الحضور % بدل 1', v_num;
  end if;
  raise notice '✅ ١) السلسلة اليومية تجمع اليوم في صفٍّ واحد بأرقامه الصحيحة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) **الفاتورة الملغاة لا تُحتسب إيرادًا**
  -- ═════════════════════════════════════════════════════════════════════════
  insert into sales_invoices (organization_id, branch_id, patient_id, invoice_type,
                              status, net_amount, created_by)
    values (v_org, v_branch, v_patient, 'sale', 'paid', 500, v_owner);
  insert into sales_invoices (organization_id, branch_id, patient_id, invoice_type,
                              status, net_amount, created_by)
    values (v_org, v_branch, v_patient, 'sale', 'void', 900, v_owner);

  select sum(revenue) into v_num from v_analytics_daily
   where organization_id = v_org and report_date = current_date;
  if v_num <> 500.00 then
    raise exception 'فشل: الإيراد % بدل 500 — الفاتورة الملغاة تُحتسب', v_num;
  end if;
  raise notice '✅ ٢) الإيراد يستثني الفواتير الملغاة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) متوسّط الانتظار يُحسب من الحضور إلى الدخول فقط
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_a uuid;
  begin
    insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                              scheduled_start, scheduled_end, status,
                              checked_in_1_at, entered_at, created_by)
      values (v_org, v_branch, v_clinic, v_doctor, v_patient,
              current_date::timestamptz + interval '9 hours',
              current_date::timestamptz + interval '9 hours 30 minutes', 'completed',
              current_date::timestamptz + interval '9 hours',
              current_date::timestamptz + interval '9 hours 20 minutes', v_owner)
      returning id into v_a;

    select max(avg_waiting_minutes) into v_int from v_analytics_daily
     where organization_id = v_org and report_date = current_date;
    if coalesce(v_int, 0) <> 20 then
      raise exception 'فشل: متوسّط الانتظار % بدل 20', v_int;
    end if;
  end;
  raise notice '✅ ٣) متوسّط الانتظار يُحسب من تسجيل الحضور إلى الدخول';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) **المقارنة بفترة سابقة بطولها نفسه**
  -- ═════════════════════════════════════════════════════════════════════════
  -- الفترة الحالية: أمس واليوم (يومان). السابقة: اليومان قبلهما.
  insert into appointments (organization_id, branch_id, clinic_id, doctor_id, patient_id,
                            scheduled_start, scheduled_end, status, created_by)
    values (v_org, v_branch, v_clinic, v_doctor, v_patient,
            (current_date - 3)::timestamptz + interval '9 hours',
            (current_date - 3)::timestamptz + interval '9 hours 30 minutes',
            'scheduled', v_owner),
           (v_org, v_branch, v_clinic, v_doctor, v_patient,
            (current_date - 3)::timestamptz + interval '10 hours',
            (current_date - 3)::timestamptz + interval '10 hours 30 minutes',
            'scheduled', v_owner);

  select current_value, previous_value, change_percent
    into v_num, v_int, v_num
    from app_analytics_summary(v_org, current_date - 1, current_date)
   where metric_key = 'appointments';

  declare v_cur numeric; v_prev numeric; v_chg numeric;
  begin
    select current_value, previous_value, change_percent into v_cur, v_prev, v_chg
      from app_analytics_summary(v_org, current_date - 1, current_date)
     where metric_key = 'appointments';
    -- الحالية: 3 (أمس) + 1 (اليوم) = 4 ؛ السابقة: يوما (‑3) و(‑2) = 2
    if v_cur <> 4 then
      raise exception 'فشل: مواعيد الفترة الحالية % بدل 4', v_cur;
    end if;
    if v_prev <> 2 then
      raise exception 'فشل: مواعيد الفترة السابقة % بدل 2 — طول المقارنة خاطئ', v_prev;
    end if;
    if v_chg <> 100.0 then
      raise exception 'فشل: نسبة التغيّر % بدل 100', v_chg;
    end if;
  end;
  raise notice '✅ ٤) المقارنة بفترةٍ سابقة بطول الفترة الحالية نفسها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) **لا نسبة تغيّر على أساس صفر**
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_chg numeric; v_prev numeric;
  begin
    select previous_value, change_percent into v_prev, v_chg
      from app_analytics_summary(v_org, current_date - 1, current_date)
     where metric_key = 'revenue';
    if v_prev <> 0 then
      raise exception 'فشل: إيراد الفترة السابقة % بدل صفر', v_prev;
    end if;
    if v_chg is not null then
      raise exception 'فشل: حُسبت نسبة تغيّر على أساس صفر (%)', v_chg;
    end if;
  end;
  raise notice '✅ ٥) الأساس الصفري لا يُنتج نسبة تغيّر مخترعة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) اتجاه المؤشّر: عدم الحضور ارتفاعه سيّئ
  -- ═════════════════════════════════════════════════════════════════════════
  if (select higher_is_better from app_analytics_summary(v_org, current_date - 1, current_date)
       where metric_key = 'no_shows') then
    raise exception 'فشل: ارتفاع عدم الحضور محسوبٌ تحسّنًا';
  end if;
  if not (select higher_is_better from app_analytics_summary(v_org, current_date - 1, current_date)
           where metric_key = 'revenue') then
    raise exception 'فشل: ارتفاع الإيراد محسوبٌ تراجعًا';
  end if;
  raise notice '✅ ٦) اتجاه كل مؤشّر معلن: ما يُحمد ارتفاعه وما يُذمّ';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الفترة المقلوبة مرفوضة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform * from app_analytics_summary(v_org, current_date, current_date - 5);
    raise exception 'فشل: قُبلت فترة نهايتها قبل بدايتها';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%قبل بدايتها%' then raise; end if;
  end;
  raise notice '✅ ٧) الفترة المقلوبة مرفوضة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) أكثر الخدمات طلبًا يعدّ المنفَّذ لا المسوَّدة
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_item uuid; v_visit uuid;
  begin
    insert into items (organization_id, item_type, code, name_ar, price)
      values (v_org, 'service', 'AN-S1', 'كشف عام', 200) returning id into v_item;
    insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                                branch_id, visit_date, status)
      values (v_org, v_patient, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
      returning id into v_visit;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, created_by)
      values (v_org, v_visit, v_item, 1, 200, 'performed', v_owner),
             (v_org, v_visit, v_item, 1, 200, 'draft', v_owner);

    select sum(times_performed), sum(total_value) into v_int, v_num
      from v_analytics_top_services
     where organization_id = v_org and item_id = v_item;
    if v_int <> 1 then
      raise exception 'فشل: عُدّت الخدمة المسوَّدة ضمن المنفَّذ (%)', v_int;
    end if;
    if v_num <> 200.00 then
      raise exception 'فشل: قيمة الخدمات % بدل 200', v_num;
    end if;
  end;
  raise notice '✅ ٨) أكثر الخدمات طلبًا يعدّ المنفَّذ لا المسوَّدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) ساعات الذروة تفصل اليوم والساعة
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_analytics_peak_hours
                  where organization_id = v_org and hour_of_day = 9) then
    raise exception 'فشل: ساعة الذروة التاسعة غائبة';
  end if;
  if not exists (select 1 from v_analytics_peak_hours
                  where organization_id = v_org and hour_of_day = 9 and no_shows > 0) then
    raise exception 'فشل: عدم الحضور غير معدود في ساعات الذروة';
  end if;
  raise notice '✅ ٩) ساعات الذروة تفصل اليوم والساعة وتعدّ عدم الحضور';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) عزل المنشآت
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_org2 uuid; v_stranger uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'an-other@test.local')
      returning id into v_stranger;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'clinic', v_stranger) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_stranger::text, true);
    begin
      perform * from app_analytics_summary(v_org, current_date - 1, current_date);
      raise exception 'فشل: قرأ غريبٌ تحليلات منشأة ليست له';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لست عضوًا%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ١٠) عزل المنشآت قائم على التحليلات';

  raise notice '——— كل فحوص التحليلات نجحت ———';
end $$;

rollback;
