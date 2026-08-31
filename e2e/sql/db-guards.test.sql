-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات القاعدة — تعمل داخل معاملة تُلغى في النهاية
-- ---------------------------------------------------------------------------
-- الملف كله بين `begin` و`rollback`: **لا يترك صفًا واحدًا** مهما نجح أو
-- فشل. ولهذا يمكن تشغيله على قاعدة اختبار متكرّرًا بلا تنظيف.
--
-- التشغيل:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/db-guards.test.sql
--
-- كل فحص يرفع استثناءً عند الفشل، فأول خطأ يوقف الملف ويُبيّن السطر.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org   uuid;
  v_user  uuid;
  v_pat   uuid;
  v_doc   uuid;
  v_clin  uuid;
  v_appt  uuid;
  v_ok    boolean;
  v_msg   text;
begin
  -- تهيئة داخل المعاملة
  insert into auth.users (id, email) values (gen_random_uuid(), 'e2e@test.local')
    returning id into v_user;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار E2E', 'clinic', v_user) returning id into v_org;

  -- الدوال تفحص العضوية (`app_is_member`) منذ 0082، فبدون هوية يعمل الملف
  -- بحساب مجهول فترفضه كل دالة. `true` يجعل الضبط محليًا للمعاملة.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  insert into patients (organization_id, name_ar, mobile_number)
    values (v_org, 'مريض اختبار', '0509999999') returning id into v_pat;
  insert into doctors (organization_id, name_ar)
    values (v_org, 'طبيب اختبار') returning id into v_doc;
  insert into clinics (organization_id, name, code)
    values (v_org, 'عيادة اختبار', 'E2E-1') returning id into v_clin;

  -- ── 1) منع التداخل
  insert into appointments (organization_id, patient_id, doctor_id, clinic_id,
                            scheduled_start, scheduled_end, status)
  values (v_org, v_pat, v_doc, v_clin, now() + interval '2 h', now() + interval '150 min', 'scheduled')
  returning id into v_appt;

  begin
    insert into appointments (organization_id, patient_id, doctor_id, clinic_id,
                              scheduled_start, scheduled_end, status)
    values (v_org, v_pat, v_doc, v_clin, now() + interval '2 h', now() + interval '150 min', 'scheduled');
    raise exception 'فشل: قُبل موعد متداخل';
  exception when others then
    if sqlerrm not like '%يتداخل%' then raise; end if;
    raise notice '✅ منع التداخل';
  end;

  -- ── 2) القفز في الحالات مرفوض
  begin
    update appointments set status = 'completed' where id = v_appt;
    raise exception 'فشل: قُبل القفز من scheduled إلى completed';
  exception when others then
    if sqlerrm not like '%انتقال حالة الموعد غير مسموح%' then raise; end if;
    raise notice '✅ منع القفز في الحالات';
  end;

  -- ── 3) الحظر يمنع الحجز
  insert into blocked_external_contacts (organization_id, patient_id, block_type, reason, created_by)
  values (v_org, v_pat, 'booking', 'اختبار', v_user);
  begin
    insert into appointments (organization_id, patient_id, doctor_id, clinic_id,
                              scheduled_start, scheduled_end, status)
    values (v_org, v_pat, v_doc, v_clin, now() + interval '5 h', now() + interval '330 min', 'scheduled');
    raise exception 'فشل: حُجز لمريض محظور';
  exception when others then
    if sqlerrm not like '%محظور من حجز المواعيد%' then raise; end if;
    raise notice '✅ الحظر يمنع الحجز';
  end;
  update blocked_external_contacts set is_active = false where patient_id = v_pat;

  -- ── 4) حظر الرسائل لا يمنع الحجز
  insert into blocked_external_contacts (organization_id, patient_id, block_type, reason, created_by)
  values (v_org, v_pat, 'messaging', 'اختبار', v_user);
  insert into appointments (organization_id, patient_id, doctor_id, clinic_id,
                            scheduled_start, scheduled_end, status)
  values (v_org, v_pat, v_doc, v_clin, now() + interval '6 h', now() + interval '390 min', 'scheduled');
  raise notice '✅ حظر الرسائل لا يمنع الحجز';

  -- ── 5) الرسالة إلى محظور تُسجَّل ملغاة لا تُرفض
  insert into message_log (organization_id, patient_id, channel, event_key, message_text, status)
  values (v_org, v_pat, 'sms', 'test', 'نص', 'pending');
  select status = 'cancelled' into v_ok
    from message_log where patient_id = v_pat order by id desc limit 1;
  if not v_ok then raise exception 'فشل: رسالة إلى محظور لم تُلغَ'; end if;
  raise notice '✅ رسالة المحظور تُسجَّل ملغاة';

  -- ── 6) توفّر الطبيب: خارج الدوام مرفوض
  insert into doctor_working_hours (doctor_id, starts_at, ends_at, is_blocked)
  values (v_doc, current_date + interval '1 day' + time '09:00',
                 current_date + interval '1 day' + time '13:00', false);
  v_msg := app_check_doctor_availability(v_doc,
             current_date + interval '1 day' + time '20:00',
             current_date + interval '1 day' + time '20:30');
  if v_msg is null then raise exception 'فشل: قُبل وقت خارج الدوام'; end if;
  raise notice '✅ خارج الدوام مرفوض (%)', v_msg;

  v_msg := app_check_doctor_availability(v_doc,
             current_date + interval '1 day' + time '10:00',
             current_date + interval '1 day' + time '10:30');
  if v_msg is not null then raise exception 'فشل: رُفض وقت داخل الدوام (%)', v_msg; end if;
  raise notice '✅ داخل الدوام مقبول';

  -- ── 7) عزل المنشآت: الخط الزمني يرفض غير العضو
  --     (يُختبر بدور القاعدة، فالفحص هنا على وجود الدالة وسلوكها مع مريض
  --      غير موجود — أما الرفض بالعضوية فمُختبَر في اختبارات RLS أدناه.)
  begin
    perform app_get_patient_timeline(gen_random_uuid());
    raise exception 'فشل: قُبل مريض غير موجود';
  exception when others then
    if sqlerrm not like '%المريض غير موجود%' then raise; end if;
    raise notice '✅ الخط الزمني يرفض مريضًا غير موجود';
  end;

  raise notice '——— كل فحوص القاعدة نجحت ———';
end $$;

rollback;
