-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات التنبيهات الداخلية — 0103
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/notification-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS**: القناة الوحيدة داخلية، وأحد الفحوص يتأكّد أن
-- القاعدة نفسها ترفض أيّ قناة خارجية.
--
-- الخطر الذي تحرسه هذه الفحوص: تنبيهٌ يصل لمن لا يعنيه (تسريب)، أو لا يصل
-- لمن يعنيه (حدثٌ حرِج يمرّ بصمت)، أو يتكرّر حتى يُتجاهل.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org      uuid;
  v_org2     uuid;
  v_owner    uuid;
  v_owner2   uuid;
  v_tech     uuid;
  v_nurse    uuid;
  v_branch   uuid;
  v_clinic   uuid;
  v_asset    uuid;
  v_n        integer;
  v_int      integer;
  v_txt      text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'nt-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'nt-tech@test.local')
    returning id into v_tech;
  insert into auth.users (id, email) values (gen_random_uuid(), 'nt-nurse@test.local')
    returning id into v_nurse;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار التنبيهات', 'clinic', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_tech, 'radiology_technician', true),
           (v_org, v_nurse, 'nurse', true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) المنشأة الجديدة تُولد بقواعد توجيه، وإلا لا يصلها تنبيه أبدًا
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from notification_rules where organization_id = v_org;
  if v_int < 10 then
    raise exception 'فشل: المنشأة الجديدة بلا قواعد توجيه (%)', v_int;
  end if;
  raise notice '✅ ١) المنشأة الجديدة تُبذر قواعد التوجيه تلقائيًّا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) **لا قناة خارجية**: القاعدة ترفض SMS من الأساس
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into notification_rules (organization_id, event_key, name_ar, channel)
      values (v_org, 'test_sms', 'اختبار', 'sms');
    raise exception 'فشل: قُبلت قناة SMS في قواعد التنبيه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    null;
  end;
  raise notice '✅ ٢) قناة SMS مرفوضة على مستوى القاعدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) التوجيه بالصلاحية: العطل الحرِج يصل لحاملي assets.maintenance وحدهم
  -- ═════════════════════════════════════════════════════════════════════════
  insert into assets (organization_id, branch_id, asset_number, name_ar, created_by)
    values (v_org, v_branch, 'NT-1', 'جهاز أشعة', v_owner) returning id into v_asset;

  insert into maintenance_requests (organization_id, branch_id, asset_id,
                                    fault_description, severity, reported_by)
    values (v_org, v_branch, v_asset, 'دخان من الجهاز', 'critical', v_owner);

  -- فنّي الأشعة يملك assets.maintenance افتراضيًّا، والممرّضة لا تملكها
  if not exists (select 1 from notifications
                  where organization_id = v_org and user_id = v_tech
                    and event_key = 'asset_critical_fault') then
    raise exception 'فشل: العطل الحرِج لم يصل لفنّي الصيانة';
  end if;
  if exists (select 1 from notifications
              where organization_id = v_org and user_id = v_nurse
                and event_key = 'asset_critical_fault') then
    raise exception 'فشل: العطل الحرِج وصل لمن لا يملك صلاحية الصيانة';
  end if;
  -- والمالك يملك كل شيء فيصله أيضًا
  if not exists (select 1 from notifications
                  where organization_id = v_org and user_id = v_owner
                    and event_key = 'asset_critical_fault') then
    raise exception 'فشل: العطل الحرِج لم يصل لمالك المنشأة';
  end if;
  raise notice '✅ ٣) التنبيه يُوجَّه بالصلاحية: يصل من يعنيه ولا يصل غيره';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) منع التكرار: الحدث نفسه لا يُنبَّه به مرّتين
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from notifications
   where organization_id = v_org and user_id = v_tech
     and event_key = 'asset_critical_fault';
  perform app_notify(v_org, v_tech, 'asset_critical_fault', 'مكرّر',
                     (select dedupe_key from notifications
                       where organization_id = v_org and user_id = v_tech
                         and event_key = 'asset_critical_fault' limit 1));
  select count(*) into v_n from notifications
   where organization_id = v_org and user_id = v_tech
     and event_key = 'asset_critical_fault';
  if v_n <> v_int then
    raise exception 'فشل: تكرّر التنبيه بنفس المفتاح (% ← %)', v_int, v_n;
  end if;

  begin
    perform app_notify(v_org, v_tech, 'x', 'بلا مفتاح', '   ');
    raise exception 'فشل: قُبل تنبيه بلا مفتاح منع تكرار';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%مفتاح منع التكرار%' then raise; end if;
  end;
  raise notice '✅ ٤) مفتاح منع التكرار إلزاميّ ويمنع الإغراق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) خروج الجهاز من الخدمة يُنبَّه به، وعودته لا تُنبَّه
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_asset_status(v_asset, 'out_of_service', 'بانتظار قطعة غيار');
  if not exists (select 1 from notifications
                  where organization_id = v_org and event_key = 'asset_out_of_service'
                    and entity_id = v_asset) then
    raise exception 'فشل: خروج الجهاز من الخدمة لم يُنبَّه به';
  end if;
  select count(*) into v_int from notifications
   where organization_id = v_org and event_key = 'asset_out_of_service';
  perform app_set_asset_status(v_asset, 'in_service', null);
  select count(*) into v_n from notifications
   where organization_id = v_org and event_key = 'asset_out_of_service';
  if v_n <> v_int then
    raise exception 'فشل: عودة الجهاز للخدمة أنشأت تنبيه خروج';
  end if;
  raise notice '✅ ٥) الخروج من الخدمة يُنبَّه به، والعودة لا تُنبِّه زورًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) الكتم يعمل، و**الحرِج لا يُكتم**
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_tech::text, true);
  perform app_set_notification_preference(v_org, 'operational', true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  if app_notify(v_org, v_tech, 'asset_out_of_service', 'عادي مكتوم', 'mute-test-1',
                null, 'operational', 'warning') is not null then
    raise exception 'فشل: وصل تنبيه في فئة مكتومة';
  end if;
  if app_notify(v_org, v_tech, 'asset_critical_fault', 'حرِج لا يُكتم', 'mute-test-2',
                null, 'operational', 'critical') is null then
    raise exception 'فشل: كُتم تنبيه حرِج';
  end if;
  raise notice '✅ ٦) الكتم يُطاع في العادي، والحرِج يخترقه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) القراءة والإخفاء: كلٌّ في صندوقه وحده
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_id uuid;
  begin
    select id into v_id from notifications
     where organization_id = v_org and user_id = v_tech limit 1;

    -- المالك لا يستطيع تعليم تنبيه غيره مقروءًا
    begin
      perform app_mark_notification_read(v_id);
      raise exception 'فشل: عُلّم تنبيه مستخدم آخر مقروءًا';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%ليس لك%' then raise; end if;
    end;

    perform set_config('request.jwt.claim.sub', v_tech::text, true);
    perform app_mark_notification_read(v_id);
    if (select read_at from notifications where id = v_id) is null then
      raise exception 'فشل: لم تُسجَّل القراءة';
    end if;

    perform app_dismiss_notification(v_id);
    if exists (select 1 from v_my_notifications where id = v_id) then
      raise exception 'فشل: التنبيه المخفيّ ما زال في الصندوق';
    end if;

    -- صندوقي يخصّني: لا أرى تنبيهات غيري
    if exists (select 1 from v_my_notifications where user_id <> v_tech) then
      raise exception 'فشل: ظهرت تنبيهات مستخدم آخر في صندوقي';
    end if;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ٧) القراءة والإخفاء لصاحب التنبيه وحده، والصندوق معزول';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) تعطيل القاعدة يوقف التنبيه
  -- ═════════════════════════════════════════════════════════════════════════
  update notification_rules set is_active = false
   where organization_id = v_org and event_key = 'asset_out_of_service';
  select count(*) into v_int from notifications
   where organization_id = v_org and event_key = 'asset_out_of_service';
  perform app_set_asset_status(v_asset, 'out_of_service', 'عطل آخر');
  select count(*) into v_n from notifications
   where organization_id = v_org and event_key = 'asset_out_of_service';
  if v_n <> v_int then
    raise exception 'فشل: قاعدة معطَّلة ما زالت تُنبِّه';
  end if;
  update notification_rules set is_active = true
   where organization_id = v_org and event_key = 'asset_out_of_service';
  raise notice '✅ ٨) تعطيل القاعدة يوقف تنبيهها فعليًّا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) قائمة الانتهاء تشمل مصادر المرحلتين 21 و22
  -- ═════════════════════════════════════════════════════════════════════════
  update assets set warranty_end_date = current_date + 10,
                    service_contract_end = current_date + 20
   where id = v_asset;
  if not exists (select 1 from expiring_alerts
                  where organization_id = v_org
                    and alert_type = 'asset_warranty_expiry') then
    raise exception 'فشل: ضمان الجهاز غائب عن قائمة الانتهاء';
  end if;
  if not exists (select 1 from expiring_alerts
                  where organization_id = v_org
                    and alert_type = 'asset_service_contract_expiry') then
    raise exception 'فشل: عقد الصيانة غائب عن قائمة الانتهاء';
  end if;
  raise notice '✅ ٩) قائمة الانتهاء الموحّدة تشمل الأجهزة والمستندات';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) توليد تنبيهات الانتهاء لا يتضاعف بتكرار الاستدعاء
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_generate_expiry_notifications(v_org, 30);
  select count(*) into v_int from notifications
   where organization_id = v_org and event_key = 'document_expiring';
  if v_int = 0 then
    raise exception 'فشل: لم تُولَّد تنبيهات انتهاء رغم وجود ما ينتهي';
  end if;
  perform app_generate_expiry_notifications(v_org, 30);
  select count(*) into v_n from notifications
   where organization_id = v_org and event_key = 'document_expiring';
  if v_n <> v_int then
    raise exception 'فشل: تكرار التوليد ضاعف التنبيهات (% ← %)', v_int, v_n;
  end if;
  raise notice '✅ ١٠) توليد تنبيهات الانتهاء آمن للتكرار';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) تجاوز الموافقة يُنبَّه به رقابيًّا وبخطورة حرِجة
  -- ═════════════════════════════════════════════════════════════════════════
  declare
    v_patient uuid; v_doctor uuid; v_visit uuid; v_item uuid; v_svc uuid;
  begin
    v_clinic := app_save_clinic(v_org, null, jsonb_build_object(
                  'code','NT1','name','عيادة','branch_id', v_branch));
    insert into doctors (organization_id, name_ar) values (v_org, 'طبيب')
      returning id into v_doctor;
    insert into patients (organization_id, name_ar) values (v_org, 'مريض')
      returning id into v_patient;
    insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id,
                                branch_id, visit_date, status)
      values (v_org, v_patient, v_doctor, v_clinic, v_branch, current_date, 'in_progress')
      returning id into v_visit;
    insert into items (organization_id, item_type, code, name_ar, price, requires_consent)
      values (v_org, 'service', 'NTS1', 'إجراء بموافقة', 900, true) returning id into v_item;
    insert into patient_visit_services (organization_id, visit_id, item_id, qty,
                                        unit_price, status, created_by)
      values (v_org, v_visit, v_item, 1, 900, 'ordered', v_owner) returning id into v_svc;

    update patient_visit_services
       set status = 'performed', consent_override_reason = 'حالة إسعافية'
     where id = v_svc;

    if not exists (select 1 from notifications
                    where organization_id = v_org and event_key = 'consent_overridden'
                      and severity = 'critical') then
      raise exception 'فشل: تجاوز الموافقة لم يُنبَّه به رقابيًّا';
    end if;
  end;
  raise notice '✅ ١١) تجاوز الموافقة يُنبِّه الرقابة بخطورة حرِجة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) عزل المنشآت: تنبيهات منشأة لا تصل عضو منشأة أخرى
  -- ═════════════════════════════════════════════════════════════════════════
  insert into auth.users (id, email) values (gen_random_uuid(), 'nt-other@test.local')
    returning id into v_owner2;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة أخرى', 'clinic', v_owner2) returning id into v_org2;
  perform set_config('request.jwt.claim.sub', v_owner2::text, true);
  if exists (select 1 from v_my_notifications where organization_id = v_org) then
    raise exception 'فشل: تسرّبت تنبيهات منشأة إلى عضو منشأة أخرى';
  end if;
  begin
    perform app_generate_expiry_notifications(v_org, 30);
    raise exception 'فشل: ولّد غريبٌ تنبيهات لمنشأة ليست له';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%لست عضوًا%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ١٢) عزل المنشآت قائم على التنبيهات';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) ملخّص الصندوق يعدّ غير المقروء والحرِج
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_tech::text, true);
  if not exists (select 1 from v_notification_summary
                  where organization_id = v_org and unread_count > 0) then
    raise exception 'فشل: الملخّص لا يعدّ غير المقروء';
  end if;
  perform app_mark_all_notifications_read(v_org);
  if exists (select 1 from v_notification_summary
              where organization_id = v_org and unread_count > 0) then
    raise exception 'فشل: تعليم الكل مقروءًا لم يُطبَّق';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ١٣) ملخّص الصندوق دقيق، وتعليم الكل مقروءًا يعمل';

  raise notice '——— كل فحوص التنبيهات نجحت ———';
end $$;

rollback;
