-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها            ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات 0143: صدق أرقام الإيراد، ومفردة الصلاحيات، ودورة المناقلة،
-- وفوترة إجراء الأسنان.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/revenue-truth.test.sql
--
-- الفكرة الجامعة: لكل مصدر إيراد نُدخل ثلاث فواتير — سارية، وملغاة، وعرض سعر
-- مؤقّت — ثم نتأكّد أن المصدر يرى السارية وحدها. الفاتورة الملغاة وعرض السعر
-- ليسا إيرادًا، وحسابهما إيرادًا يرفع الإقرار الضريبي وعمولة الطبيب على مال لم
-- يُقبض.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_owner    uuid;
  v_other    uuid;
  v_org      uuid;
  v_org2     uuid;
  v_branch   uuid;
  v_doctor   uuid;
  v_clinic   uuid;
  v_patient  uuid;
  v_item     uuid;
  v_offer    uuid;
  v_wh1      uuid;
  v_wh2      uuid;
  v_visit    uuid;
  v_proc     uuid;
  v_inv_ok   uuid;
  v_inv_void uuid;
  v_inv_tmp  uuid;
  v_num      numeric;
  v_int      int;
  v_txt      text;
  v_uuid     uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'rev-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'rev-other@test.local')
    returning id into v_other;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار الإيراد', 'medical_center', v_owner) returning id into v_org;
  insert into branches (organization_id, name, code)
    values (v_org, 'الفرع الرئيسي', 'RV-1') returning id into v_branch;
  insert into doctors (organization_id, file_number, name_ar)
    values (v_org, 9401, 'د. الإيراد') returning id into v_doctor;
  insert into clinics (organization_id, name, code)
    values (v_org, 'عيادة الإيراد', 'RVC-1') returning id into v_clinic;
  insert into patients (organization_id, name_ar, id_number)
    values (v_org, 'مريض الإيراد', '1000000143') returning id into v_patient;
  insert into items (organization_id, code, name_ar, item_type, price, cost_price)
    values (v_org, 'RV-ITEM', 'خدمة الإيراد', 'service', 300, 100) returning id into v_item;
  insert into offers (organization_id, title, discount_percent)
    values (v_org, 'عرض الاختبار', 10) returning id into v_offer;

  -- ثلاث فواتير: سارية 300، ملغاة 1000، وعرض سعر مؤقّت 5000.
  insert into sales_invoices (organization_id, patient_id, doctor_id, clinic_id,
                              applied_offer_id, subtotal_amount, discount_amount,
                              vat_amount, net_amount, paid_amount, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_offer, 300, 0, 45, 345, 345, 'paid')
    returning id into v_inv_ok;
  insert into sales_invoices (organization_id, patient_id, doctor_id, clinic_id,
                              applied_offer_id, subtotal_amount, discount_amount,
                              vat_amount, net_amount, paid_amount, status)
    values (v_org, v_patient, v_doctor, v_clinic, v_offer, 1000, 100, 135, 1035, 0, 'void')
    returning id into v_inv_void;
  insert into sales_invoices (organization_id, patient_id, doctor_id, clinic_id,
                              applied_offer_id, subtotal_amount, discount_amount,
                              vat_amount, net_amount, paid_amount, status, is_temporary)
    values (v_org, v_patient, v_doctor, v_clinic, v_offer, 5000, 500, 675, 5175, 0, 'unpaid', true)
    returning id into v_inv_tmp;

  insert into sales_invoice_items (invoice_id, item_id, qty, price, net_amount)
    values (v_inv_ok, v_item, 1, 300, 300);
  insert into sales_invoice_items (invoice_id, item_id, qty, price, net_amount)
    values (v_inv_void, v_item, 4, 300, 1200);
  insert into sales_invoice_items (invoice_id, item_id, qty, price, net_amount)
    values (v_inv_tmp, v_item, 20, 300, 6000);

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) مؤشّرات الفواتير: الملغاة وعرض السعر خارج الحساب
  -- ═════════════════════════════════════════════════════════════════════════
  select net_amount into v_num
    from app_invoice_kpis(v_org, current_date - 1, current_date + 1);
  if v_num <> 345 then
    raise exception 'فشل: مؤشّرات الفواتير أعطت % لا 345', v_num;
  end if;
  raise notice '✅ ١) المؤشّرات تحتسب الفاتورة السارية وحدها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) المؤشّرات لا تُقرأ من خارج المنشأة
  --    الدالّة بصلاحيات المالك، فبلا فحص عضوية كانت تكشف أرقام أي منشأة.
  -- ═════════════════════════════════════════════════════════════════════════
  insert into organizations (name, organization_type, created_by)
    values ('منشأة أخرى', 'medical_center', v_other) returning id into v_org2;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  begin
    perform net_amount from app_invoice_kpis(v_org, current_date - 1, current_date + 1);
    raise exception 'فشل: غريبٌ قرأ مؤشّرات منشأة ليس عضوًا فيها';
  exception when others then
    if sqlerrm not like '%لا تنتمي لهذه المنشأة%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ٢) المؤشّرات محجوبة عن غير الأعضاء';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) كشف الضريبة: الملغاة وعرض السعر خارج الإقرار
  -- ═════════════════════════════════════════════════════════════════════════
  select coalesce(sum(vat_amount), 0), count(*) into v_num, v_int
    from v_vat_statement_sales_invoices where organization_id = v_org;
  if v_int <> 1 or v_num <> 45 then
    raise exception 'فشل: كشف الضريبة % فاتورة بضريبة % لا فاتورة واحدة بـ45', v_int, v_num;
  end if;
  raise notice '✅ ٣) كشف الضريبة على الفواتير السارية وحدها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) الربحية: الملغاة وعرض السعر لا يظهران
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from v_invoice_profitability where organization_id = v_org;
  if v_int <> 1 then
    raise exception 'فشل: الربحية % فاتورة لا واحدة', v_int;
  end if;
  select estimated_cost into v_num from v_invoice_profitability where invoice_id = v_inv_ok;
  if v_num <> 100 then
    raise exception 'فشل: التكلفة التقديرية % لا 100', v_num;
  end if;
  raise notice '✅ ٤) الربحية للفاتورة السارية وحدها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) الإيراد حسب المصدر
  -- ═════════════════════════════════════════════════════════════════════════
  select coalesce(sum(net_amount), 0) into v_num
    from v_daily_revenue_by_source where organization_id = v_org;
  if v_num <> 345 then
    raise exception 'فشل: الإيراد حسب المصدر % لا 345', v_num;
  end if;
  raise notice '✅ ٥) الإيراد حسب مصدر المريض صادق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) إجماليات العروض: خصم الملغاة والمؤقّتة لا يُنسب للعرض
  -- ═════════════════════════════════════════════════════════════════════════
  select applied_invoice_count, total_discount_amount into v_int, v_num
    from v_offers_totals where offer_id = v_offer;
  if v_int <> 1 then
    raise exception 'فشل: العرض نُسبت له % فاتورة لا واحدة', v_int;
  end if;
  if v_num <> 0 then
    raise exception 'فشل: خصم العرض % والفاتورة السارية بلا خصم', v_num;
  end if;
  raise notice '✅ ٦) إجماليات العروض لا تحتسب الملغاة ولا المؤقّتة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) الأصناف الأكثر مبيعًا: البنود الملغاة والمؤقّتة لا تُحتسب
  --    هذا كان أخفى الأخطاء: الشرط كان في `on` والمجاميع تقرأ من البنود، فلم
  --    يكن يُسقط سطرًا واحدًا. 1 لا 25.
  -- ═════════════════════════════════════════════════════════════════════════
  select qty_sold into v_num from v_sales_by_item where item_id = v_item;
  if v_num <> 1 then
    raise exception 'فشل: الكمية المبيعة % لا 1 — بنود الملغاة والمؤقّتة تُحتسب', v_num;
  end if;
  raise notice '✅ ٧) الأصناف الأكثر مبيعًا تحتسب البنود السارية وحدها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) الإيراد حسب الطبيب وحسب العيادة
  -- ═════════════════════════════════════════════════════════════════════════
  select net_amount into v_num from v_revenue_by_doctor where doctor_id = v_doctor;
  if v_num <> 345 then
    raise exception 'فشل: إيراد الطبيب % لا 345', v_num;
  end if;
  select net_amount into v_num from v_revenue_by_clinic where clinic_id = v_clinic;
  if v_num <> 345 then
    raise exception 'فشل: إيراد العيادة % لا 345', v_num;
  end if;
  raise notice '✅ ٨) إيراد الطبيب والعيادة صادق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) دالّتا الإيراد بالفترة: تحترمان المدى فعلًا
  --    المنظورَان بلا تاريخ، فكان جدولا الشاشة يعرضان كل التاريخ تحت مرشّح
  --    فترة: يغيّر المستخدم «من/إلى» فلا يتحرّك شيء.
  -- ═════════════════════════════════════════════════════════════════════════
  select net_amount into v_num
    from app_revenue_by_doctor(v_org, current_date - 1, current_date + 1)
   where doctor_id = v_doctor;
  if v_num <> 345 then
    raise exception 'فشل: دالّة إيراد الطبيب أعطت % لا 345', v_num;
  end if;
  select count(*) into v_int
    from app_revenue_by_doctor(v_org, current_date - 30, current_date - 20);
  if v_int <> 0 then
    raise exception 'فشل: دالّة إيراد الطبيب لا تحترم المدى (% صفًّا في فترة خالية)', v_int;
  end if;
  select count(*) into v_int
    from app_revenue_by_clinic(v_org, current_date - 30, current_date - 20);
  if v_int <> 0 then
    raise exception 'فشل: دالّة إيراد العيادة لا تحترم المدى';
  end if;
  select net_amount into v_num
    from app_revenue_by_clinic(v_org, current_date - 1, current_date + 1)
   where clinic_id = v_clinic;
  if v_num <> 345 then
    raise exception 'فشل: دالّة إيراد العيادة أعطت % لا 345', v_num;
  end if;
  raise notice '✅ ٩) دالّتا الإيراد بالفترة تحترمان المدى';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) «خدمات نُفِّذت ولم تُفوتَر»: المسوّدة والطلب غير المنفَّذ ليسا منها
  -- ═════════════════════════════════════════════════════════════════════════
  insert into patient_visits (organization_id, patient_id, doctor_id, clinic_id, status)
    values (v_org, v_patient, v_doctor, v_clinic, 'in_progress') returning id into v_visit;
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_item, 1, 300, 'draft');
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_item, 1, 300, 'ordered');
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price, status)
    values (v_org, v_visit, v_item, 1, 300, 'performed');
  select count(*) into v_int from v_unbilled_performed_services where organization_id = v_org;
  if v_int <> 1 then
    raise exception 'فشل: تقرير غير المفوتَر % سطرًا لا واحدًا (يحتسب ما لم يُنفَّذ)', v_int;
  end if;
  raise notice '✅ ١٠) تقرير غير المفوتَر يعرض المنفَّذ وحده';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) المناقلة المخزنية: تُنشأ بلا ذكر الحالة
  --     القيمة الافتراضية كانت `pending` وقيدها لا يقبلها، فكان إنشاء أي
  --     مناقلة مرفوضًا — ولذلك الجدول فارغ في كل قاعدة.
  -- ═════════════════════════════════════════════════════════════════════════
  insert into warehouses (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'مستودع أ', 'WH-A') returning id into v_wh1;
  insert into warehouses (organization_id, branch_id, name, code)
    values (v_org, v_branch, 'مستودع ب', 'WH-B') returning id into v_wh2;
  insert into stock_transfers (organization_id, from_warehouse_id, to_warehouse_id, note)
    values (v_org, v_wh1, v_wh2, 'اختبار')
    returning status into v_txt;
  if v_txt <> 'draft' then
    raise exception 'فشل: حالة المناقلة الافتراضية % لا draft', v_txt;
  end if;
  raise notice '✅ ١١) طلب المناقلة يُنشأ ويبدأ مسوّدة';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) إجراء الأسنان: يُفوتَر على الزيارة المفتوحة ولو لم تُمرَّر
  -- ═════════════════════════════════════════════════════════════════════════
  update items set dental_procedure_kind = 'filling' where id = v_item;
  perform app_plan_tooth_procedures(
            v_org, v_patient,
            jsonb_build_array(jsonb_build_object(
              'tooth', '11', 'tooth_type', 'permanent', 'item_id', v_item,
              'surfaces', array['occlusal'], 'note', null)),
            null, null, v_branch);
  select id into v_proc from tooth_procedures
   where patient_id = v_patient and tooth_number = '11' and status = 'planned';
  if v_proc is null then
    raise exception 'فشل: لم يُخطَّط الإجراء';
  end if;

  perform app_complete_tooth_procedure(v_proc, null, null, true);

  select visit_id, visit_service_id::text into v_uuid, v_txt from tooth_procedures where id = v_proc;
  if v_uuid <> v_visit then
    raise exception 'فشل: الإجراء لم يُربط بالزيارة المفتوحة';
  end if;
  if v_txt is null then
    raise exception 'فشل: الإجراء اكتمل ولم يُنشأ له بند فوترة';
  end if;
  select count(*) into v_int
    from patient_visit_services
   where visit_id = v_visit and note = 'سنّ 11' and performed_by = v_doctor;
  if v_int <> 1 then
    raise exception 'فشل: بند الإجراء بلا طبيب منفِّذ';
  end if;
  raise notice '✅ ١٢) إجراء الأسنان يُفوتَر على الزيارة المفتوحة وباسم طبيبها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 13) إجراء بلا زيارة مفتوحة: خطأ صريح لا فوترة صامتة
  -- ═════════════════════════════════════════════════════════════════════════
  update patient_visits set status = 'closed' where id = v_visit;
  perform app_plan_tooth_procedures(
            v_org, v_patient,
            jsonb_build_array(jsonb_build_object(
              'tooth', '12', 'tooth_type', 'permanent', 'item_id', v_item,
              'surfaces', array['mesial'], 'note', null)),
            null, null, v_branch);
  select id into v_proc from tooth_procedures
   where patient_id = v_patient and tooth_number = '12' and status = 'planned';
  begin
    perform app_complete_tooth_procedure(v_proc, null, null, true);
    raise exception 'فشل: أُتمّ إجراء للفوترة بلا زيارة مفتوحة';
  exception when others then
    if sqlerrm not like '%لا توجد زيارة مفتوحة%' then raise; end if;
  end;
  -- وبلا فوترة يُتمّ بلا اعتراض: عملٌ سُجّل سريريًّا ولن يُحاسَب عليه بقرارٍ
  -- صريح لا بصمت.
  perform app_complete_tooth_procedure(v_proc, null, null, false);
  select status into v_txt from tooth_procedures where id = v_proc;
  if v_txt <> 'completed' then
    raise exception 'فشل: الإجراء بلا فوترة لم يُتمّ';
  end if;
  raise notice '✅ ١٣) بلا زيارة مفتوحة: خطأ صريح للفوترة، وإتمامٌ بلا فوترة مسموح';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 14) الصلاحيات: كل شاشة في النظام لها مفتاح في الكتالوج، والمنح يعمل
  --     كان 22 من 38 مفتاحًا في نافذة الصلاحيات يفشل بـ«صلاحية غير معروفة».
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int
    from feature_catalog f
   where not exists (select 1 from permission_catalog p
                      where p.permission_key = f.feature_key || '.view');
  if v_int <> 0 then
    raise exception 'فشل: % ميزة بلا مفتاح صلاحية لفتح شاشتها', v_int;
  end if;

  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_other, 'receptionist', true)
    on conflict (organization_id, user_id) do update set role_key = 'receptionist';
  perform app_set_member_permission(v_org, v_other, 'reception.view', true, 'اختبار');
  if not exists (
    select 1 from membership_permissions
     where organization_id = v_org and user_id = v_other
       and permission_key = 'reception.view' and granted
  ) then
    raise exception 'فشل: لم تُمنح صلاحية فتح شاشة الاستقبال';
  end if;

  select is_allowed into v_txt
    from v_user_effective_permissions
   where organization_id = v_org and user_id = v_other and permission_key = 'patients.view';
  if v_txt is distinct from 'true' then
    raise exception 'فشل: افتراض دور الاستقبال لا يُظهر صلاحية فتح شاشة المرضى (%)', v_txt;
  end if;
  raise notice '✅ ١٤) مفردة صلاحيات واحدة: المنح يعمل والافتراض يصدق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 15) الحضور: المناوبة المُسندة تُقاس عليها بداية الدوام
  --     كان `shift_template_id` لا يُكتب أبدًا، فالتأخير صفر دائمًا وسماحية
  --     المناوبة بلا أثر في النظام كلّه.
  -- ═════════════════════════════════════════════════════════════════════════
  insert into employees (organization_id, branch_id, name_ar, job_number)
    values (v_org, v_branch, 'موظف الحضور', 'RV-EMP')
    returning id into v_uuid;
  insert into shift_templates (organization_id, name_ar, start_time, end_time, grace_minutes)
    values (v_org, 'صباحية', '08:00', '16:00', 10)
    returning id into v_proc;
  insert into employee_shift_assignments (organization_id, employee_id, shift_template_id,
                                          weekdays, effective_from)
    values (v_org, v_uuid, v_proc, '{0,1,2,3,4,5,6}', current_date - 30);

  insert into attendance_records (organization_id, employee_id, work_date, check_in_at)
    values (v_org, v_uuid, current_date, current_date + time '11:00');
  select shift_template_id, late_minutes, status
    into v_uuid, v_int, v_txt
    from attendance_records
   where employee_id = (select id from employees where job_number = 'RV-EMP')
     and work_date = current_date;
  if v_uuid is null then
    raise exception 'فشل: صفّ الحضور بلا مناوبة، فلا يُقاس عليه تأخير';
  end if;
  if v_int <> 170 then
    raise exception 'فشل: التأخير % دقيقة لا 170 (11:00 على مناوبة 08:00 بسماحية 10)', v_int;
  end if;
  if v_txt <> 'late' then
    raise exception 'فشل: حالة الحضور % لا late', v_txt;
  end if;
  raise notice '✅ ١٥) الحضور يُقاس على المناوبة المُسندة: تأخير 170 دقيقة وحالة «متأخر»';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 16) الأشعة: ختم «نُفِّذ» لا يتخطّى نفي الحمل ولا الصلاحية
  --     كانت الشاشة تكتب `performed_at` مباشرة، فيرفع المحفِّز الطلب إلى «الصور
  --     جاهزة» بلا أي من حرّاس الطلب — ومنها نفي الحمل قبل فحص مُشعِّع.
  -- ═════════════════════════════════════════════════════════════════════════
  update patients set gender = 'female' where id = v_patient;
  insert into radiology_exams (organization_id, name_ar, billing_item_id, pregnancy_check_required)
    values (v_org, 'أشعة سينية', v_item, true) returning id into v_uuid;
  insert into radiology_orders (organization_id, patient_id, ordering_doctor_id)
    values (v_org, v_patient, v_doctor) returning id into v_proc;
  insert into radiology_order_items (radiology_order_id, radiology_exam_id)
    values (v_proc, v_uuid);

  begin
    update radiology_order_items set performed_at = now()
     where radiology_order_id = v_proc;
    raise exception 'فشل: خُتم فحص مُشعِّع منفَّذًا بلا نفي الحمل';
  exception when others then
    if sqlerrm not like '%نفي الحمل%' then raise; end if;
  end;

  update radiology_orders set pregnancy_confirmed_not = true where id = v_proc;
  update radiology_order_items set performed_at = now() where radiology_order_id = v_proc;
  select status into v_txt from radiology_orders where id = v_proc;
  if v_txt <> 'images_ready' then
    raise exception 'فشل: الطلب لم ينتقل إلى «الصور جاهزة» بعد تنفيذ فحوصه (%)', v_txt;
  end if;
  raise notice '✅ ١٦) تنفيذ فحص الأشعة يمرّ بنفي الحمل ثم يرفع الطلب';

  raise notice '——— كل فحوص 0143 نجحت ———';
end $$;

rollback;
