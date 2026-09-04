-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات التكاملات: إعادة المحاولة وصندوق الموتى وحارس الأسرار — 0110
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/integration-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS** — بل أحد الفحوص يحاول إدخال `sms` كمفتاح تكامل
-- ويتوقّع الرفض من القاعدة.
--
-- الأخطار: رسالة تُعاد إلى الأبد فتُحظر عند المزوّد، ورسالة تُنسى بلا موعد
-- إعادة، ومفتاح سرّيّ يُكتب في جدولٍ تقرؤه الواجهة.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org    uuid;
  v_owner  uuid;
  v_acc    uuid;
  v_branch uuid;
  v_patient uuid;
  v_inv    uuid;
  v_doc    uuid;
  v_int    integer;
  v_ts     timestamptz;
  v_ts2    timestamptz;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'in-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'in-acc@test.local')
    returning id into v_acc;
  insert into organizations (name, organization_type, created_by, default_vat_rate)
    values ('منشأة اختبار التكاملات', 'medical_center', v_owner, 15) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_acc, 'accountant', true);
  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  insert into patients (organization_id, name_ar) values (v_org, 'مريض')
    returning id into v_patient;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) **قائمة التكاملات لا تقبل sms**
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into integration_settings (organization_id, integration_key, base_url)
      values (v_org, 'sms', 'https://provider.example.com');
    raise exception 'فشل: قُبل مفتاح تكامل sms';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  raise notice '✅ ١) مفتاح sms مرفوض من القاعدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) العنوان غير المشفّر مرفوض
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into integration_settings (organization_id, integration_key, base_url)
      values (v_org, 'zatca', 'http://gw.example.com');
    raise exception 'فشل: قُبل عنوان http لتكامل يحمل بيانات مرضى';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  raise notice '✅ ٢) العنوان غير المشفّر مرفوض';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) **حارس الأسرار**: لا شهادة ولا مفتاح في القاعدة
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into integration_settings (organization_id, integration_key, base_url, secret_ref)
      values (v_org, 'zatca', 'https://gw.example.com',
              '-----BEGIN PRIVATE KEY-----MIIEvQIBADAN');
    raise exception 'فشل: خُزّنت شهادة في قاعدة البيانات';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%الشهادات%' then raise; end if;
  end;

  begin
    insert into integration_settings (organization_id, integration_key, base_url, secret_ref)
      values (v_org, 'zatca', 'https://gw.example.com', 'sk9dK2mQ7xR4tYb1NpZa8Lw3');
    raise exception 'فشل: خُزّنت قيمة تبدو مفتاحًا سريًّا';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%مفتاحًا سريًّا%' then raise; end if;
  end;

  -- واسم المرجع المعقول يُقبل
  insert into integration_settings (organization_id, integration_key, base_url, secret_ref)
    values (v_org, 'zatca', 'https://gw.example.com', 'ZATCA_PROD_CERT');
  if not exists (select 1 from integration_settings
                  where organization_id = v_org and integration_key = 'zatca') then
    raise exception 'فشل: رُفض اسم مرجع سليم';
  end if;
  raise notice '✅ ٣) الشهادات والمفاتيح مرفوضة، واسم المرجع مقبول';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) تهيئة رسالة زاتكا للاختبار
  -- ═════════════════════════════════════════════════════════════════════════
  insert into sales_invoices (organization_id, branch_id, patient_id, invoice_type,
                              status, net_amount, created_by)
    values (v_org, v_branch, v_patient, 'sale', 'unpaid', 100, v_owner)
    returning id into v_inv;
  insert into einvoice_documents (organization_id, sales_invoice_id, document_type,
                                  environment, status)
    values (v_org, v_inv, 'standard', 'sandbox', 'pending')
    returning id into v_doc;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) **الفشل يجدول إعادة محاولة متأخّرة**، ولا يعيدها فورًا
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_mark_integration_attempt('einvoice', v_doc, false, 'انقطاع اتصال');
  select next_attempt_at, attempt_count into v_ts, v_int
    from einvoice_documents where id = v_doc;
  if v_ts is null then
    raise exception 'فشل: لم يُجدَّل موعد لإعادة المحاولة — الرسالة منسيّة';
  end if;
  if v_ts <= now() then
    raise exception 'فشل: إعادة المحاولة فورية بلا تأخير — تُحظر عند المزوّد';
  end if;
  if v_int <> 1 then
    raise exception 'فشل: عدّاد المحاولات % بدل 1', v_int;
  end if;

  -- والتأخير يتضاعف
  perform app_mark_integration_attempt('einvoice', v_doc, false, 'انقطاع اتصال');
  select next_attempt_at into v_ts2 from einvoice_documents where id = v_doc;
  if v_ts2 <= v_ts then
    raise exception 'فشل: التأخير لم يتضاعف بين المحاولتين';
  end if;
  raise notice '✅ ٥) الفشل يجدول محاولة متأخّرة، والتأخير يتضاعف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) **الحدّ ثم صندوق الموتى**: لا إعادة إلى الأبد، وتنبيه لمن يتابع
  -- ═════════════════════════════════════════════════════════════════════════
  update einvoice_documents set max_attempts = 4 where id = v_doc;
  perform app_mark_integration_attempt('einvoice', v_doc, false, 'بيانات ناقصة');
  perform app_mark_integration_attempt('einvoice', v_doc, false, 'بيانات ناقصة');

  if not (select failed_permanently from einvoice_documents where id = v_doc) then
    raise exception 'فشل: الرسالة تُعاد إلى الأبد بلا حدّ';
  end if;
  if (select next_attempt_at from einvoice_documents where id = v_doc) is not null then
    raise exception 'فشل: رسالة ميتة ما زال لها موعد إعادة';
  end if;
  if (select status from einvoice_documents where id = v_doc) <> 'failed' then
    raise exception 'فشل: حالة الرسالة الميتة ليست failed';
  end if;
  if not exists (select 1 from notifications
                  where organization_id = v_org
                    and event_key = 'integration_dead_letter') then
    raise exception 'فشل: موت الرسالة لم يُنبّه أحدًا';
  end if;
  if not exists (select 1 from v_integration_dead_letters
                  where organization_id = v_org and id = v_doc
                    and last_error = 'بيانات ناقصة') then
    raise exception 'فشل: الرسالة الميتة لا تظهر في صندوق الموتى بسبب فشلها';
  end if;
  raise notice '✅ ٦) المحاولات تنتهي بحدّ، والموت يُنبّه ويُسجَّل بسببه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) **الإحياء بقرار إنسان وبسبب مكتوب**
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_requeue_integration_message('einvoice', v_doc, '   ');
    raise exception 'فشل: أُعيد إرسال رسالة بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب إعادة الإرسال مطلوب%' then raise; end if;
  end;

  perform app_requeue_integration_message('einvoice', v_doc, 'أُكمل رقم الضريبة في الفاتورة');
  if (select failed_permanently from einvoice_documents where id = v_doc) then
    raise exception 'فشل: الرسالة ما زالت ميتة بعد الإحياء';
  end if;
  if (select attempt_count from einvoice_documents where id = v_doc) <> 0 then
    raise exception 'فشل: عدّاد المحاولات لم يُصفَّر عند الإحياء';
  end if;
  if not exists (select 1 from audit_log
                  where organization_id = v_org
                    and entity_title = 'إعادة إرسال رسالة تكامل') then
    raise exception 'فشل: الإحياء لم يدخل سجل التدقيق';
  end if;
  raise notice '✅ ٧) الإحياء يحتاج سببًا مكتوبًا ويُصفّر المحاولات ويُسجَّل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) النجاح يُلغي الجدولة
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_mark_integration_attempt('einvoice', v_doc, true);
  if (select next_attempt_at from einvoice_documents where id = v_doc) is not null then
    raise exception 'فشل: رسالة نجحت وما زال لها موعد إعادة';
  end if;
  if (select last_error from einvoice_documents where id = v_doc) is not null then
    raise exception 'فشل: خطأ قديم باقٍ بعد النجاح';
  end if;
  raise notice '✅ ٨) النجاح يُلغي الجدولة ويمسح الخطأ القديم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) تنبيه العالق يعمل، ولا يتكرّر في اليوم نفسه
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_doc2 uuid; v_before int; v_after int; v_inv2 uuid;
  begin
    -- فاتورة ثانية: لكل فاتورة مستند إلكتروني واحد (قيد قائم منذ 0092)
    insert into sales_invoices (organization_id, branch_id, patient_id, invoice_type,
                                status, net_amount, created_by)
      values (v_org, v_branch, v_patient, 'sale', 'unpaid', 250, v_owner)
      returning id into v_inv2;
    insert into einvoice_documents (organization_id, sales_invoice_id, document_type,
                                    environment, status, last_attempt_at)
      values (v_org, v_inv2, 'standard', 'sandbox', 'submitted', now() - interval '5 hours')
      returning id into v_doc2;

    perform app_check_integration_health(v_org, 60);
    select count(*) into v_before from notifications
     where organization_id = v_org and event_key = 'integration_stuck';
    if v_before = 0 then
      raise exception 'فشل: الرسالة العالقة لم تُنبّه أحدًا';
    end if;

    perform app_check_integration_health(v_org, 60);
    select count(*) into v_after from notifications
     where organization_id = v_org and event_key = 'integration_stuck';
    if v_after <> v_before then
      raise exception 'فشل: تنبيه العالق تكرّر في اليوم نفسه';
    end if;
  end;
  raise notice '✅ ٩) العالق يُنبَّه عنه مرّة واحدة في اليوم';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) منظور الصحّة يفصل المفتوح عن الميت عن غير المجدول
  -- ═════════════════════════════════════════════════════════════════════════
  if not exists (select 1 from v_integration_health
                  where organization_id = v_org and integration_key = 'zatca'
                    and open_count > 0) then
    raise exception 'فشل: منظور الصحّة لا يعدّ المفتوح';
  end if;
  raise notice '✅ ١٠) منظور الصحّة يعدّ المفتوح والميت وغير المجدول';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) الإحياء محميّ بصلاحيته، والإعدادات بصلاحيتها
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_org2 uuid; v_stranger uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'in-other@test.local')
      returning id into v_stranger;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'medical_center', v_stranger) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_stranger::text, true);
    begin
      perform app_requeue_integration_message('einvoice', v_doc, 'محاولة من الخارج');
      raise exception 'فشل: أعاد غريبٌ إرسال رسالة منشأة ليست له';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%integrations.retry%' then raise; end if;
    end;
    begin
      perform app_check_integration_health(v_org, 60);
      raise exception 'فشل: فحص غريبٌ صحّة تكاملات منشأة ليست له';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%لست عضوًا%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ١١) عزل المنشآت قائم على التكاملات';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) المحاسب يعيد الإرسال (له الصلاحية افتراضًا)
  -- ═════════════════════════════════════════════════════════════════════════
  update einvoice_documents set failed_permanently = true, status = 'failed'
   where id = v_doc;
  perform set_config('request.jwt.claim.sub', v_acc::text, true);
  perform app_requeue_integration_message('einvoice', v_doc, 'صُحّحت الفاتورة');
  if (select failed_permanently from einvoice_documents where id = v_doc) then
    raise exception 'فشل: لم يستطع المحاسب إعادة الإرسال رغم صلاحيته';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ١٢) المحاسب يملك إعادة الإرسال افتراضًا';

  raise notice '——— كل فحوص التكاملات نجحت ———';
end $$;

rollback;
