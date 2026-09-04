-- ============================================================================
-- تنظيف البيانات التجريبية قبل التشغيل الحقيقي
-- ============================================================================
-- يُزيل ما أدخلته 0118 و0119 و0127 من **أشخاص وسجلّات مخترعة**: ثلاثة مرضى
-- ومواعيدهم واشتراكاتهم التأمينية، وستة موظفين، وثلاثة أطباء تجريبيين،
-- ووردية صندوق مفتوحة.
--
-- ما **لا** يحذفه، وهو مقصود:
--   • دليل الحسابات، السنة والفترة المالية، إعدادات الضريبة، قائمة الأسعار،
--     المستودع — هذه تهيئةٌ تحتاجها فعلًا، وكانت في قائمة ما ينقصك.
--   • الأقسام والعيادات والموارد والخدمات وشركة التأمين وعقدها والفحوص.
--   • الأطباء الخمسة الذين أضافتهم 0132 (أمجد، محمد، نبيلة، نجاة، نوف)
--     — هؤلاء أطباؤك الحقيقيون لا بيانات تجريبية.
--   • سجل التدقيق: لا يُمسّ إطلاقًا. أثر ما جرى يبقى.
--
-- ── كيف يُستعمل ───────────────────────────────────────────────────────────
--   1) شغّله كما هو. لن يحذف شيئًا — سيعرض تقريرًا بما سيُحذف فقط.
--   2) إن وافقك التقرير، غيّر `v_dry_run` أدناه إلى `false` وشغّله ثانية.
--
-- يُنفَّذ داخل معاملة واحدة: إن فشل شيء لم يتغيّر شيء.
-- **لا شيء يخصّ SMS هنا.**
-- ============================================================================

do $cleanup$
declare
  -- ⬇⬇⬇  غيّرها إلى false لتنفيذ الحذف فعليًّا  ⬇⬇⬇
  v_dry_run boolean := true;

  c_patient_ids   constant text[] := array['1000000001','1000000002','1000000003'];
  c_demo_doctors  constant text[] := array['د. خالد عبدالعزيز','د. نورة السالم','د. ريم عبدالله'];
  c_demo_jobs     constant text   := 'DEMO-E%';

  v_patients uuid[];
  v_doctors  uuid[];
  v_employees uuid[];
  v_n int;
begin
  select coalesce(array_agg(id), '{}') into v_patients
    from patients where id_number = any(c_patient_ids);
  select coalesce(array_agg(id), '{}') into v_doctors
    from doctors where name_ar = any(c_demo_doctors);
  select coalesce(array_agg(id), '{}') into v_employees
    from employees where job_number like c_demo_jobs;

  raise notice '════════ ما سيُحذف ════════';
  raise notice 'مرضى تجريبيون: %', coalesce(array_length(v_patients, 1), 0);
  select count(*) into v_n from appointments where patient_id = any(v_patients);
  raise notice '  مواعيدهم: %', v_n;
  select count(*) into v_n from patient_visits where patient_id = any(v_patients);
  raise notice '  زياراتهم: %', v_n;
  select count(*) into v_n from patient_insurance_memberships where patient_id = any(v_patients);
  raise notice '  اشتراكاتهم التأمينية: %', v_n;
  raise notice 'أطباء تجريبيون: %', coalesce(array_length(v_doctors, 1), 0);
  raise notice 'موظفون تجريبيون (DEMO-E*): %', coalesce(array_length(v_employees, 1), 0);
  select count(*) into v_n from cash_register_shifts where status = 'open';
  raise notice 'ورديات صندوق مفتوحة: %', v_n;
  raise notice '═══════════════════════════';

  if v_dry_run then
    raise notice '⚠️  وضع المعاينة — لم يُحذف شيء. غيّر v_dry_run إلى false ثم أعد التشغيل.';
    return;
  end if;

  -- ── الحذف بترتيب المفاتيح الأجنبية ─────────────────────────────────────
  -- المريض أولًا بأبنائه، ثم الطبيب والموظف بروابطهما.
  delete from patient_insurance_memberships where patient_id = any(v_patients);
  delete from appointments                    where patient_id = any(v_patients);
  delete from patient_visits                  where patient_id = any(v_patients);
  delete from patients                        where id = any(v_patients);

  delete from doctor_schedules where doctor_id = any(v_doctors);
  delete from doctor_services  where doctor_id = any(v_doctors);
  delete from doctor_clinics   where doctor_id = any(v_doctors);
  delete from doctor_branches  where doctor_id = any(v_doctors);
  delete from doctors          where id = any(v_doctors);

  delete from employees where id = any(v_employees);

  -- الوردية المفتوحة تمنع فتح وردية حقيقية.
  delete from cash_register_shifts where status = 'open';

  raise notice '✅ حُذفت البيانات التجريبية. سجل التدقيق لم يُمسّ.';
end
$cleanup$;
