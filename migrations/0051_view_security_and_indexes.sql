-- ---------------------------------------------------------------------------
-- 0051_view_security_and_indexes.sql
-- المهام 10 و11 و12: تأمين الـViews، تضييق الصلاحيات، فهارس المرحلة.
-- ---------------------------------------------------------------------------
-- (10) الـViews التي تتجاوز RLS
--
--   المنظور في PostgreSQL يُنفَّذ افتراضيًا بصلاحيات **مالكه** لا بصلاحيات
--   المستعلم، فيتجاوز RLS على الجداول الأصلية. أصلحتُ ستةً منها في 0044،
--   وفحص هذه الهجرة كشف أن **33 منظورًا آخر** ما زال على السلوك الافتراضي —
--   أي أن أي عضو في أي منشأة يقرأ منها بيانات كل المنشآت.
--
--   الإصلاح `security_invoker = on`: المنظور ينفَّذ بصلاحيات المستعلم فتسري
--   عليه سياسات RLS للجداول الأصلية. وكلها تحمل `organization_id` (تُحقِّق
--   منه)، وجداولها الأصلية عليها RLS بالفعل — فالتحويل كافٍ بلا شرط إضافي.
--
--   **الاستثناء الوحيد `v_audit_log_detail`**: يقرأ `auth.users` لعرض بريد
--   المستخدم، ولا سياسة RLS تسمح للمستخدم العادي بقراءتها — فـ`security_invoker`
--   سيُفرغه تمامًا. أُصلح في 0044 بالطريقة الصحيحة لحالته: يبقى بصلاحيات
--   المالك مع شرط `app_is_member(organization_id)` مكتوب داخله. لا يُمَس هنا.
-- ---------------------------------------------------------------------------
alter view dental_lab_balances set (security_invoker = on);
alter view expiring_alerts set (security_invoker = on);
alter view v_account_balances set (security_invoker = on);
alter view v_agreements_stats set (security_invoker = on);
alter view v_available_drug_lots set (security_invoker = on);
alter view v_daily_revenue_by_source set (security_invoker = on);
alter view v_employee_contracts_status set (security_invoker = on);
alter view v_employee_training_summary set (security_invoker = on);
alter view v_hr_attendance_monthly set (security_invoker = on);
alter view v_hr_dashboard_summary set (security_invoker = on);
alter view v_hr_latest_performance set (security_invoker = on);
alter view v_internal_unread_counts set (security_invoker = on);
alter view v_invoice_profitability set (security_invoker = on);
alter view v_lab_pending_orders set (security_invoker = on);
alter view v_leave_balances_current_year set (security_invoker = on);
alter view v_occupational_exam_report set (security_invoker = on);
alter view v_offers_totals set (security_invoker = on);
alter view v_organization_members_directory set (security_invoker = on);
alter view v_patient_journey set (security_invoker = on);
alter view v_patient_package_balances set (security_invoker = on);
alter view v_prescriptions_pending_dispensing set (security_invoker = on);
alter view v_radiology_unreported_orders set (security_invoker = on);
alter view v_recruitment_pipeline set (security_invoker = on);
alter view v_returns_statement_items set (security_invoker = on);
alter view v_returns_statement_receipts set (security_invoker = on);
alter view v_revenue_by_clinic set (security_invoker = on);
alter view v_revenue_by_doctor set (security_invoker = on);
alter view v_sales_by_item set (security_invoker = on);
alter view v_temporary_invoices_stats set (security_invoker = on);
alter view v_today_attendance set (security_invoker = on);
alter view v_trial_balance set (security_invoker = on);
alter view v_vat_statement_sales_invoices set (security_invoker = on);
alter view v_vat_statement_vouchers set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- (11) حجب دور `anon` عن كل منظورات المخطط
--
--   `anon` هو الدور قبل تسجيل الدخول. لا شاشة في هذا النظام تعرض بيانات قبل
--   الدخول، فقراءته من أي منظور لا وظيفة لها — وحجبه طبقة دفاع ثانية خلف
--   `security_invoker` لا بديل عنه.
--
--   الحجب على المنظورات وحدها لا الجداول: سياسات RLS على الجداول مبنية على
--   `app_is_member()` و`auth.uid()` وتمنع `anon` أصلًا، وسحب صلاحياته من
--   الجداول قد يكسر مسار التسجيل الأول في Onboarding.
-- ---------------------------------------------------------------------------
do $$
declare v record;
begin
  for v in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke all on %I from anon', v.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- (12) فهارس المرحلة: المواعيد والاستقبال والزيارة والفاتورة
--
--   لكل فهرس هنا **مستهلكان**:
--
--   1. الاستعلامات: شاشات المواعيد والاستقبال تصفّي دائمًا بـ`organization_id`
--      ثم بالمريض أو الطبيب أو العيادة. بلا فهرس مركّب يمسح PostgreSQL كل
--      مواعيد المنشأة ثم يصفّي — مقبول عند مئات الصفوف، قاتل عند ملايينها.
--
--   2. **قيود العزل المضافة في 0050**: مفتاح أجنبي مركّب `(organization_id, X)`
--      يفحص الجانب المُشير عند كل حذف أو تحديث للأب. بلا فهرس على أعمدة
--      المفتاح يصبح كل حذف مريض أو طبيب مسحًا تسلسليًا لجدول المواعيد كاملًا.
--      وهذا سبب كافٍ وحده.
--
--   `if not exists` يجعل الهجرة قابلة لإعادة التشغيل. ولم أستعمل `concurrently`
--   لأنها لا تعمل داخل معاملة، والجداول هنا لم تكبر بعد.
-- ---------------------------------------------------------------------------
create index if not exists idx_appointments_org_patient on appointments (organization_id, patient_id);
create index if not exists idx_appointments_org_doctor  on appointments (organization_id, doctor_id);
create index if not exists idx_appointments_org_clinic  on appointments (organization_id, clinic_id);

create index if not exists idx_waitlist_org_patient on appointment_waitlist (organization_id, patient_id);
create index if not exists idx_waitlist_org_doctor  on appointment_waitlist (organization_id, doctor_id);

create index if not exists idx_patient_visits_org_appointment on patient_visits (organization_id, appointment_id);
create index if not exists idx_sales_invoices_org_appointment on sales_invoices (organization_id, appointment_id);

create index if not exists idx_reminder_jobs_org on appointment_reminder_jobs (organization_id);

-- جزئي: أغلب صفوف السجل ليست مرتبطة بموعد، وفهرستها كلها تخزين بلا فائدة
create index if not exists idx_message_log_appointment on message_log (appointment_id) where appointment_id is not null;
