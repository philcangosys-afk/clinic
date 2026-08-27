-- ============================================================================
-- 0025_audit_log_triggers.sql
-- المرحلة 7.1 — معالجة فجوة موثَّقة: تعبئة سجل التدقيق (audit_log) تلقائيًا
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001 إلى 0024 مباشرة
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- المشكلة الموثَّقة في هذا الملف منذ المرحلة 5.3: جدول audit_log (من 0001)
-- موجود وتُعرَض بياناته في شاشة "سجل التدقيق"، لكن لا شيء كان يُعبِّئه تلقائيًا
-- — الاعتماد كان على كل شاشة تُدرِج صفًا بنفسها، وهو عمل لم يُنفَّذ. هذا الملف
-- يحل المشكلة بدالة Trigger **عامة قابلة لإعادة الاستخدام على أي جدول** بدل
-- كتابة 11 دالة منفصلة، ثم يربطها بأهم 11 جدولًا تشغيليًا في المشروع.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- دالة التدقيق العامة — تُستخدَم على أي جدول به عمود organization_id وعمود
-- معرّف id من نوع uuid. اسم عمود "العنوان المعروض" يُمرَّر كوسيط للـ Trigger
-- (TG_ARGV[0]) حتى لا تحتاج كل جدول دالة مخصَّصة به.
-- ---------------------------------------------------------------------------
create or replace function app_audit_log_auto()
returns trigger
language plpgsql
security definer
as $$
declare
  v_row jsonb;
  v_title text;
  v_action text;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

  if TG_NARGS > 0 then
    v_title := v_row ->> TG_ARGV[0];
  end if;

  v_action := case TG_OP when 'INSERT' then 'add' when 'UPDATE' then 'update' when 'DELETE' then 'delete' end;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title)
  values (
    (v_row ->> 'organization_id')::uuid,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    (v_row ->> 'id')::uuid,
    v_title
  );

  return coalesce(NEW, OLD);
end;
$$;

comment on function app_audit_log_auto() is
  'Trigger عام يُسجِّل كل إضافة/تعديل/حذف في audit_log تلقائيًا. يُستخدَم بتمرير اسم عمود العنوان كوسيط: for each row execute function app_audit_log_auto(''name_ar''). يتطلب أن يحتوي الجدول على organization_id و id (uuid) — وهو افتراض صحيح لكل الجداول التشغيلية في هذا المشروع.';

-- ---------------------------------------------------------------------------
-- ربط الدالة بأهم 11 جدولًا تشغيليًا (وليس كل جدول في المشروع — توسعة هذا
-- الربط لأي جدول آخر لاحقًا سطر واحد فقط بنفس النمط أدناه)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_audit_patients on patients;
create trigger trg_audit_patients
  after insert or update or delete on patients
  for each row execute function app_audit_log_auto('name_ar');

drop trigger if exists trg_audit_doctors on doctors;
create trigger trg_audit_doctors
  after insert or update or delete on doctors
  for each row execute function app_audit_log_auto('name_ar');

drop trigger if exists trg_audit_employees on employees;
create trigger trg_audit_employees
  after insert or update or delete on employees
  for each row execute function app_audit_log_auto('name_ar');

drop trigger if exists trg_audit_sales_invoices on sales_invoices;
create trigger trg_audit_sales_invoices
  after insert or update or delete on sales_invoices
  for each row execute function app_audit_log_auto('invoice_number');

drop trigger if exists trg_audit_employee_contracts on employee_contracts;
create trigger trg_audit_employee_contracts
  after insert or update or delete on employee_contracts
  for each row execute function app_audit_log_auto('contract_number');

drop trigger if exists trg_audit_job_postings on job_postings;
create trigger trg_audit_job_postings
  after insert or update or delete on job_postings
  for each row execute function app_audit_log_auto('title_ar');

drop trigger if exists trg_audit_candidates on candidates;
create trigger trg_audit_candidates
  after insert or update or delete on candidates
  for each row execute function app_audit_log_auto('name_ar');

drop trigger if exists trg_audit_chart_of_accounts on chart_of_accounts;
create trigger trg_audit_chart_of_accounts
  after insert or update or delete on chart_of_accounts
  for each row execute function app_audit_log_auto('name_ar');

drop trigger if exists trg_audit_journal_entries on journal_entries;
create trigger trg_audit_journal_entries
  after insert or update or delete on journal_entries
  for each row execute function app_audit_log_auto('reference_type');

drop trigger if exists trg_audit_packages on packages;
create trigger trg_audit_packages
  after insert or update or delete on packages
  for each row execute function app_audit_log_auto('name_ar');

drop trigger if exists trg_audit_training_programs on training_programs;
create trigger trg_audit_training_programs
  after insert or update or delete on training_programs
  for each row execute function app_audit_log_auto('name_ar');

-- ============================================================================
-- نهاية 0025_audit_log_triggers.sql
-- الخطوة التالية: 0026_internal_messages.sql (جدول دردشة داخلية فعلي بين
-- المستخدمين — محادثات ثنائية/جماعية برسائل نصية، مفصول تمامًا عن
-- message_log الذي هو سجل إشعارات خارجية للمرضى لا محادثات داخلية)
-- ============================================================================
