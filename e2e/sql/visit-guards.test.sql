-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات دورة حياة الزيارة — 0087
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/visit-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- اثنا عشر فحصًا: القفز مرفوض، التوقيع يسجّل الموقِّع، الزيارة الموقَّعة لا
-- تُعدَّل مباشرةً، إعادة الفتح تحتاج صلاحية وسببًا وتمسح التوقيع، الإغلاق
-- يُمنع وثمّة خدمة لم تُفوتَر، الإلغاء يُمنع على فاتورة سارية، والمنظور
-- يكشف الزيارات غير المكتملة.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_doctor_user uuid;
  v_patient uuid;
  v_doctor  uuid;
  v_item    uuid;
  v_visit   uuid;
  v_svc     uuid;
  v_inv     uuid;
  v_txt     text;
  v_int     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'vst-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'vst-doctor@test.local')
    returning id into v_doctor_user;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار الزيارات', 'medical_center', v_owner) returning id into v_org;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_doctor_user, 'doctor', true);
  insert into patients (organization_id, name_ar) values (v_org, 'مريض الزيارات')
    returning id into v_patient;
  insert into doctors (organization_id, name_ar, user_id)
    values (v_org, 'طبيب الزيارات', v_doctor_user) returning id into v_doctor;
  insert into items (organization_id, item_type, code, name_ar, price)
    values (v_org, 'service', 'VST-1', 'كشف', 200) returning id into v_item;

  -- ── 1) الزيارة تُنشأ ثم تبدأ
  insert into patient_visits (organization_id, patient_id, doctor_id, visit_date, status)
    values (v_org, v_patient, v_doctor, current_date, 'planned') returning id into v_visit;

  perform app_set_visit_status(v_visit, 'in_progress');
  if (select started_at from patient_visits where id = v_visit) is null then
    raise exception 'فشل: وقت البدء لم يُسجَّل';
  end if;
  raise notice '✅ بدء الزيارة يسجّل وقته';

  -- ── 2) القفز مرفوض
  begin
    perform app_set_visit_status(v_visit, 'closed');
    raise exception 'فشل: قُبل القفز من جارية إلى مغلقة';
  exception when others then
    if sqlerrm not like '%لا يمكن الانتقال%' then raise; end if;
    raise notice '✅ القفز في حالات الزيارة مرفوض';
  end;

  perform app_set_visit_status(v_visit, 'completed');

  -- ── 3) التوقيع يسجّل الموقِّع
  perform app_set_visit_status(v_visit, 'signed');
  if (select signed_by from patient_visits where id = v_visit) is null then
    raise exception 'فشل: الموقِّع لم يُسجَّل';
  end if;
  raise notice '✅ التوقيع يسجّل الموقِّع ووقته';

  -- ── 4) الزيارة الموقَّعة لا تُعدَّل مباشرةً
  --
  -- التوقيع بلا قفلٍ يليه ليس توقيعًا.
  begin
    update patient_visits set main_complaint = 'شكوى معدَّلة' where id = v_visit;
    raise exception 'فشل: عُدِّلت زيارة موقَّعة مباشرةً';
  exception when others then
    if sqlerrm not like '%أعد فتحها%' then raise; end if;
    raise notice '✅ الزيارة الموقَّعة لا تُعدَّل مباشرةً';
  end;

  -- ── 5) إعادة الفتح تحتاج سببًا
  begin
    perform app_set_visit_status(v_visit, 'in_progress');
    raise exception 'فشل: أُعيد الفتح بلا سبب';
  exception when others then
    if sqlerrm not like '%سببًا مكتوبًا%' then raise; end if;
    raise notice '✅ إعادة الفتح تحتاج سببًا';
  end;

  -- ── 6) إعادة الفتح تمسح التوقيع وتُسجَّل
  perform app_set_visit_status(v_visit, 'in_progress', 'نقص في التشخيص');
  if (select signed_at from patient_visits where id = v_visit) is not null then
    raise exception 'فشل: التوقيع بقي بعد إعادة الفتح — توقيعٌ على محتوى تغيّر';
  end if;
  select reopen_reason into v_txt from patient_visits where id = v_visit;
  if v_txt <> 'نقص في التشخيص' then
    raise exception 'فشل: سبب إعادة الفتح لم يُحفظ (%)', v_txt;
  end if;
  if not exists (select 1 from audit_log where entity_id = v_visit and module = 'visits'
                   and details like '%إعادة فتح%') then
    raise exception 'فشل: إعادة الفتح لم تُسجَّل في التدقيق';
  end if;
  raise notice '✅ إعادة الفتح تمسح التوقيع وتُسجَّل بسببها';

  -- ── 7) التعديل بعد إعادة الفتح مسموح
  update patient_visits set main_complaint = 'شكوى محدَّثة' where id = v_visit;
  raise notice '✅ التعديل بعد إعادة الفتح مسموح';

  -- ── 8) الإغلاق يُمنع وثمّة خدمة لم تُفوتَر
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price)
    values (v_org, v_visit, v_item, 1, 200) returning id into v_svc;

  perform app_set_visit_status(v_visit, 'completed');
  perform app_set_visit_status(v_visit, 'signed');
  begin
    perform app_set_visit_status(v_visit, 'closed');
    raise exception 'فشل: أُغلقت زيارة على خدمة لم تُفوتَر — إسقاط صامت لإيراد';
  exception when others then
    if sqlerrm not like '%لم تُفوتَر%' then raise; end if;
    raise notice '✅ الإغلاق يُمنع على خدمة لم تُفوتَر';
  end;

  -- ── 9) بعد الفوترة يُقبل الإغلاق
  insert into sales_invoices (organization_id, patient_id, invoice_type, status, net_amount)
    values (v_org, v_patient, 'sale', 'paid', 200) returning id into v_inv;
  insert into sales_invoice_items (invoice_id, item_id, price, qty, net_amount, visit_service_id)
    values (v_inv, v_item, 200, 1, 200, v_svc);

  perform app_set_visit_status(v_visit, 'closed');
  if (select closed_by from patient_visits where id = v_visit) is null then
    raise exception 'فشل: المُغلِق لم يُسجَّل';
  end if;
  raise notice '✅ الإغلاق بعد الفوترة يُقبل ويسجّل المُغلِق';

  -- ── 10) المغلقة تُعاد فتحها بصلاحية، وتمسح الإغلاق
  perform app_set_visit_status(v_visit, 'in_progress', 'تصحيح فاتورة');
  if (select closed_at from patient_visits where id = v_visit) is not null then
    raise exception 'فشل: الإغلاق بقي بعد إعادة الفتح';
  end if;
  raise notice '✅ إعادة فتح المغلقة تمسح الإغلاق';

  -- ── 11) الإلغاء يُمنع على فاتورة سارية
  begin
    perform app_set_visit_status(v_visit, 'cancelled', 'خطأ');
    raise exception 'فشل: أُلغيت زيارة عليها فاتورة سارية';
  exception when others then
    if sqlerrm not like '%فاتورة سارية%' then raise; end if;
    raise notice '✅ الإلغاء يُمنع على فاتورة سارية';
  end;

  -- ── 12) منظور غير المكتملة
  --
  -- زيارةُ اليوم الجارية **ليست** غير مكتملة — هي عمل اليوم. المنظور يكشف
  -- الجارية **من يوم سابق**، وهو التمييز الذي يجعله مفيدًا لا مزعجًا.
  if exists (select 1 from v_incomplete_visits where id = v_visit) then
    raise exception 'فشل: زيارة اليوم الجارية عُدّت غير مكتملة';
  end if;

  declare v_old uuid;
  begin
    insert into patient_visits (organization_id, patient_id, doctor_id, visit_date, status)
      values (v_org, v_patient, v_doctor, current_date - 3, 'in_progress') returning id into v_old;
    if not exists (select 1 from v_incomplete_visits where id = v_old) then
      raise exception 'فشل: زيارة جارية من يوم سابق لا تظهر في المنظور';
    end if;
    select issue into v_txt from v_incomplete_visits where id = v_old;
    if v_txt <> 'زيارة جارية من يوم سابق' then
      raise exception 'فشل: سبب عدم الاكتمال خاطئ (%)', v_txt;
    end if;
  end;
  raise notice '✅ منظور غير المكتملة يكشف الجارية من يوم سابق ويترك عمل اليوم';

  -- ── 13) الصلاحيات: الطبيب يوقّع ولا يعيد الفتح
  perform set_config('request.jwt.claim.sub', v_doctor_user::text, true);
  perform app_set_visit_status(v_visit, 'completed');
  perform app_set_visit_status(v_visit, 'signed');
  begin
    perform app_set_visit_status(v_visit, 'in_progress', 'محاولة');
    raise exception 'فشل: الطبيب أعاد فتح زيارة موقَّعة';
  exception when others then
    if sqlerrm not like '%visits.reopen%' then raise; end if;
    raise notice '✅ الطبيب يوقّع ولا يعيد الفتح';
  end;

  raise notice '——— كل فحوص الزيارات نجحت ———';
end $$;

rollback;
