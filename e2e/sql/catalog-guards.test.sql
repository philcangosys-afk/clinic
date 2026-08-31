-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات كتالوج الخدمات — 0071 إلى 0076
-- ---------------------------------------------------------------------------
-- الملف كله بين `begin` و`rollback`: **لا يترك صفًا واحدًا** مهما نجح أو فشل،
-- فيمكن تشغيله على قاعدة اختبار متكرّرًا بلا تنظيف.
--
-- التشغيل:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/catalog-guards.test.sql
--
-- كل فحص يرفع استثناءً عند الفشل، فأول خطأ يوقف الملف ويُبيّن السطر.
--
-- ما يغطّيه — أربعة عشر فحصًا:
--   الأرشفة ترفض خدمةً تنتظر الفوترة، والاستعادة تُعيدها معطَّلة، وغياب
--   صفوف الفروع يعني كل الفروع، وتاريخ السعر يُغلق ولا يُمحى، وأسبقية
--   القوائم، ورفض التأريخ للخلف، والعمر والجنس يمنعان، والموافقة المسبقة
--   تنبيه عند الحجز ومانع عند التنفيذ، والمورد الغائب يمنع، ودورة الحياة
--   ترفض القفز، والفاتورة النقدية تُنقل الخدمة إلى «مدفوعة»، وبند من باقة
--   أخرى مرفوض، والرصيد لا يُتجاوَز.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org    uuid;
  v_user   uuid;
  v_branch uuid;
  v_branch2 uuid;
  v_clin   uuid;
  v_doc    uuid;
  v_pat_f  uuid;   -- أنثى بالغة
  v_pat_m  uuid;   -- ذكر طفل
  v_item   uuid;
  v_list_base uuid;
  v_list_ins  uuid;
  v_company   uuid;
  v_res    uuid;
  v_visit  uuid;
  v_svc    uuid;
  v_inv    uuid;
  v_price  numeric;
  v_kind   text;
  v_check  jsonb;
  v_status text;
  v_pkg    uuid;
  v_pkg_item uuid;
  v_sub    uuid;
  v_pkg2   uuid;
  v_pkg_item2 uuid;
begin
  -- ── تهيئة
  insert into auth.users (id, email) values (gen_random_uuid(), 'catalog-e2e@test.local')
    returning id into v_user;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار الكتالوج', 'clinic', v_user) returning id into v_org;

  -- الدوال تفحص `auth.uid()` — بدون هذا يعمل الملف بهوية فارغة فتُرفض كل
  -- عملية تحتاج صلاحية. `true` تجعل الضبط محليًا للمعاملة فينتهي مع rollback.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  insert into branches (organization_id, name, code) values (v_org, 'فرع أ', 'CAT-A')
    returning id into v_branch;
  insert into branches (organization_id, name, code) values (v_org, 'فرع ب', 'CAT-B')
    returning id into v_branch2;
  insert into clinics (organization_id, name, code) values (v_org, 'عيادة الكتالوج', 'CAT-C')
    returning id into v_clin;
  insert into doctors (organization_id, name_ar) values (v_org, 'طبيب الكتالوج')
    returning id into v_doc;
  insert into insurance_companies (organization_id, name_ar) values (v_org, 'شركة اختبار')
    returning id into v_company;
  insert into patients (organization_id, name_ar, birth_date, gender)
    values (v_org, 'مريضة بالغة', current_date - interval '30 years', 'female')
    returning id into v_pat_f;
  insert into patients (organization_id, name_ar, birth_date, gender)
    values (v_org, 'طفل', current_date - interval '6 years', 'male')
    returning id into v_pat_m;
  insert into items (organization_id, item_type, code, name_ar, price)
    values (v_org, 'service', 'CAT-SRV', 'خدمة الاختبار', 500)
    returning id into v_item;

  -- ── 1) غياب صفوف الفروع = كل الفروع
  if not app_item_available_in_branch(v_item, v_branch) then
    raise exception 'فشل: خدمة بلا صفوف فروع اعتُبرت غير متاحة';
  end if;
  raise notice '✅ غياب صفوف الفروع يعني كل الفروع';

  -- ── 2) تقييد على فرع يمنع الآخر
  insert into item_branches (organization_id, item_id, branch_id) values (v_org, v_item, v_branch2);
  if app_item_available_in_branch(v_item, v_branch) then
    raise exception 'فشل: الخدمة متاحة في فرع لم تُقيَّد به';
  end if;
  if not app_item_available_in_branch(v_item, v_branch2) then
    raise exception 'فشل: الخدمة غير متاحة في فرعها المقيَّد';
  end if;
  delete from item_branches where item_id = v_item;
  raise notice '✅ تقييد الفروع يعمل في الاتجاهين';

  -- ── 3) تاريخ السعر: الإغلاق على اليوم السابق
  insert into price_lists (organization_id, name, list_kind, effective_from)
    values (v_org, 'أساس الاختبار', 'base', current_date - 60) returning id into v_list_base;
  perform app_set_price_list_item(v_list_base, v_item, 400, current_date - 60);
  perform app_set_price_list_item(v_list_base, v_item, 450, current_date - 10);

  if (select count(*) from price_list_items
       where price_list_id = v_list_base and item_id = v_item and effective_to is null) <> 1 then
    raise exception 'فشل: أكثر من سعر مفتوح لنفس الخدمة';
  end if;
  if (select effective_to from price_list_items
       where price_list_id = v_list_base and item_id = v_item and effective_from = current_date - 60)
     <> current_date - 11 then
    raise exception 'فشل: السعر القديم لم يُغلق على اليوم السابق';
  end if;
  raise notice '✅ تغيير السعر يغلق القديم ولا يمحوه';

  -- ── 4) رفض التأريخ للخلف ورفض سعر لم يتغيّر
  begin
    perform app_set_price_list_item(v_list_base, v_item, 470, current_date - 30);
    raise exception 'فشل: قُبل تأريخ سعر للخلف';
  exception when others then
    if sqlerrm not like '%يجب أن يكون بعد%' then raise; end if;
    raise notice '✅ التأريخ للخلف مرفوض';
  end;

  begin
    perform app_set_price_list_item(v_list_base, v_item, 450, current_date + 5);
    raise exception 'فشل: قُبل سعر لم يتغيّر';
  exception when others then
    if sqlerrm not like '%لم يتغيّر%' then raise; end if;
    raise notice '✅ السعر غير المتغيّر مرفوض';
  end;

  -- ── 5) الأسبقية: تأمين يتقدّم على الأساس
  insert into price_lists (organization_id, name, list_kind, insurance_company_id, effective_from)
    values (v_org, 'تعرفة الاختبار', 'insurance', v_company, current_date - 60)
    returning id into v_list_ins;
  perform app_set_price_list_item(v_list_ins, v_item, 300, current_date - 60);

  select price, source_kind into v_price, v_kind
    from app_resolve_item_price(v_org, v_item, null, null, null, current_date);
  if v_price <> 450 or v_kind <> 'base' then
    raise exception 'فشل: بلا تأمين توقّعنا 450/base فجاء %/%', v_price, v_kind;
  end if;

  select price, source_kind into v_price, v_kind
    from app_resolve_item_price(v_org, v_item, null, v_company, null, current_date);
  if v_price <> 300 or v_kind <> 'insurance' then
    raise exception 'فشل: مع التأمين توقّعنا 300/insurance فجاء %/%', v_price, v_kind;
  end if;
  raise notice '✅ أسبقية قوائم الأسعار';

  -- ── 6) السعر في تاريخ ماضٍ هو سعر ذلك اليوم
  select price into v_price
    from app_resolve_item_price(v_org, v_item, null, null, null, current_date - 20);
  if v_price <> 400 then
    raise exception 'فشل: سعر ما قبل ٢٠ يومًا توقّعناه 400 فجاء %', v_price;
  end if;
  raise notice '✅ السعر التاريخي يُقرأ بتاريخه';

  -- ── 7) العمر والجنس يمنعان
  update items set gender_restriction = 'female', min_age_years = 18 where id = v_item;
  v_check := app_check_service_eligibility(v_item, v_pat_f, null, 'execution');
  if not (v_check ->> 'ok')::boolean then
    raise exception 'فشل: مُنعت مريضة مطابقة (%)', v_check -> 'blocks';
  end if;
  v_check := app_check_service_eligibility(v_item, v_pat_m, null, 'execution');
  if (v_check ->> 'ok')::boolean then
    raise exception 'فشل: قُبل مريض مخالف للعمر والجنس';
  end if;
  if jsonb_array_length(v_check -> 'blocks') <> 2 then
    raise exception 'فشل: توقّعنا مانعين (عمر وجنس) فجاء %', v_check -> 'blocks';
  end if;
  raise notice '✅ العمر والجنس يمنعان';

  -- ── 8) الموافقة المسبقة: تنبيه عند الحجز، مانع عند التنفيذ
  update items set requires_preauthorization = true where id = v_item;
  if not (app_check_service_eligibility(v_item, v_pat_f, null, 'booking') ->> 'ok')::boolean then
    raise exception 'فشل: مُنع الحجز لغياب موافقة مسبقة';
  end if;
  if (app_check_service_eligibility(v_item, v_pat_f, null, 'execution') ->> 'ok')::boolean then
    raise exception 'فشل: قُبل التنفيذ بلا موافقة مسبقة';
  end if;
  update items set requires_preauthorization = false where id = v_item;
  raise notice '✅ الموافقة المسبقة: تنبيه عند الحجز ومانع عند التنفيذ';

  -- ── 9) مورد مطلوب غائب يمنع
  insert into resources (organization_id, branch_id, resource_type, name_ar)
    values (v_org, v_branch2, 'device', 'جهاز الاختبار') returning id into v_res;
  insert into item_resources (organization_id, item_id, resource_id, is_required)
    values (v_org, v_item, v_res, true);
  if (app_check_service_eligibility(v_item, v_pat_f, v_branch, 'execution') ->> 'ok')::boolean then
    raise exception 'فشل: قُبلت خدمة موردها في فرع آخر';
  end if;
  if not (app_check_service_eligibility(v_item, v_pat_f, v_branch2, 'execution') ->> 'ok')::boolean then
    raise exception 'فشل: مُنعت خدمة موردها متاح في فرعها';
  end if;
  delete from item_resources where item_id = v_item;
  raise notice '✅ المورد المطلوب يمنع حيث لا يوجد';

  -- ── 10) الحجز يرث العيادة ويُرفض لمريض غير ملائم
  update items set default_clinic_id = v_clin where id = v_item;
  begin
    insert into appointments (organization_id, patient_id, doctor_id, branch_id, item_id,
                              scheduled_start, scheduled_end, status)
    values (v_org, v_pat_m, v_doc, v_branch, v_item,
            now() + interval '3 days', now() + interval '3 days 30 min', 'scheduled');
    raise exception 'فشل: قُبل حجز خدمة لا تصلح للمريض';
  exception when others then
    if sqlerrm not like '%لا يمكن حجز%' then raise; end if;
    raise notice '✅ الحجز يُرفض للمريض غير الملائم';
  end;

  -- ── 11) دورة الحياة: القفز مرفوض
  insert into patient_visits (organization_id, patient_id, doctor_id, visit_date)
    values (v_org, v_pat_f, v_doc, current_date) returning id into v_visit;
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price)
    values (v_org, v_visit, v_item, 1, 450) returning id into v_svc;

  begin
    perform app_set_visit_service_status(v_svc, 'paid');
    raise exception 'فشل: قُبل القفز من performed إلى paid';
  exception when others then
    if sqlerrm not like '%لا يمكن الانتقال%' then raise; end if;
    raise notice '✅ دورة الحياة ترفض القفز';
  end;

  -- ── 12) الفاتورة النقدية (تُنشأ مدفوعة) تنقل الخدمة إلى «مدفوعة»
  insert into sales_invoices (organization_id, patient_id, invoice_type, status, net_amount)
    values (v_org, v_pat_f, 'sale', 'paid', 450) returning id into v_inv;
  insert into sales_invoice_items (invoice_id, item_id, price, qty, net_amount, visit_service_id)
    values (v_inv, v_item, 450, 1, 450, v_svc);

  select status into v_status from patient_visit_services where id = v_svc;
  if v_status <> 'paid' then
    raise exception 'فشل: بعد فاتورة نقدية مدفوعة توقّعنا paid فجاء %', v_status;
  end if;
  raise notice '✅ الفاتورة النقدية تنقل الخدمة إلى مدفوعة';

  -- ── 13) الأرشفة ترفض خدمة تنتظر الفوترة، وتُقبل بعدها
  insert into patient_visit_services (organization_id, visit_id, item_id, qty, unit_price)
    values (v_org, v_visit, v_item, 1, 450);
  begin
    perform app_archive_item(v_item, 'اختبار');
    raise exception 'فشل: أُرشفت خدمة تنتظر الفوترة';
  exception when others then
    if sqlerrm like '%أُرشفت خدمة%' then raise; end if;
    raise notice '✅ الأرشفة ترفض خدمة تنتظر الفوترة';
  end;

  delete from patient_visit_services
   where visit_id = v_visit and id <> v_svc;
  perform app_archive_item(v_item, 'اختبار');
  if not (select is_archived and is_disabled from items where id = v_item) then
    raise exception 'فشل: الأرشفة لم تُعطّل الخدمة';
  end if;
  perform app_restore_item(v_item);
  if (select is_archived or not is_disabled from items where id = v_item) then
    raise exception 'فشل: الاستعادة لم تُعِد الخدمة معطَّلة';
  end if;
  raise notice '✅ الأرشفة والاستعادة (تُعاد معطَّلة)';

  -- ── 14) الباقات: بند من باقة أخرى مرفوض، والرصيد لا يُتجاوَز
  --
  -- الخدمة عادت من الأرشيف **معطَّلة**، وفحص الملاءمة يمنع المعطَّل. تُفعَّل
  -- هنا كي يختبر ما بعده الرصيدَ لا التعطيل.
  update items set is_disabled = false, gender_restriction = 'any', min_age_years = null
   where id = v_item;

  insert into packages (organization_id, name_ar, price, is_active)
    values (v_org, 'باقة الاختبار', 900, true) returning id into v_pkg;
  insert into package_items (package_id, item_id, quantity_included)
    values (v_pkg, v_item, 2) returning id into v_pkg_item;
  insert into patient_packages (organization_id, patient_id, package_id, status)
    values (v_org, v_pat_f, v_pkg, 'active') returning id into v_sub;

  -- باقة ثانية ببندها، لاختبار «بند من باقة أخرى» اختبارًا حقيقيًا لا بمعرّف
  -- عشوائي يرفضه القيد الأجنبي قبل أن يصل إلى الحارس.
  insert into packages (organization_id, name_ar, price, is_active)
    values (v_org, 'باقة أخرى', 300, true) returning id into v_pkg2;
  insert into package_items (package_id, item_id, quantity_included)
    values (v_pkg2, v_item, 5) returning id into v_pkg_item2;

  begin
    insert into patient_package_usages (patient_package_id, package_item_id, quantity_used)
    values (v_sub, v_pkg_item2, 1);
    raise exception 'فشل: قُبل بند من باقة أخرى';
  exception when others then
    if sqlerrm not like '%لا ينتمي%' then raise; end if;
    raise notice '✅ بند من باقة أخرى مرفوض';
  end;

  insert into patient_package_usages (patient_package_id, package_item_id, quantity_used)
    values (v_sub, v_pkg_item, 2);
  begin
    insert into patient_package_usages (patient_package_id, package_item_id, quantity_used)
    values (v_sub, v_pkg_item, 1);
    raise exception 'فشل: تُوُوزِي رصيد الباقة';
  exception when others then
    if sqlerrm not like '%تتجاوز المتبقي%' then raise; end if;
    raise notice '✅ رصيد الباقة لا يُتجاوَز';
  end;

  raise notice '——— كل فحوص الكتالوج نجحت ———';
end $$;

rollback;
