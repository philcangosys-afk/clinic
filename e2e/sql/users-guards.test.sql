-- ############################################################################
-- ##  ⚠️  ملف اختبار — لا يُنفَّذ على قاعدة الإنتاج (Supabase) إطلاقًا.       ##
-- ##  يُنشئ منشأة ومرضى وفواتير وهمية للتحقّق من القواعد، ثم يتراجع عنها     ##
-- ##  (begin … rollback). الملفات التي تُنفَّذ على القاعدة هي ملفات مجلد     ##
-- ##  `migrations` فقط، بالترتيب الرقمي.                                    ##
-- ############################################################################
-- ---------------------------------------------------------------------------
-- اختبارات المستخدمين والصلاحيات — 0108
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f e2e/sql/users-guards.test.sql
--
-- الملف كله بين `begin` و`rollback`: لا يترك صفًا واحدًا.
--
-- **لا شيء هنا يخصّ SMS.**
--
-- ثلاثة أخطار تحرسها هذه الفحوص: قفل المنشأة على نفسها بإزالة آخر مالك،
-- وترقية النفس، وصلاحيةٌ فعلية لا يعرف بها أحد.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_owner2  uuid;
  v_mgr     uuid;
  v_doc     uuid;
  v_branch  uuid;
  v_int     integer;
  v_txt     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'us-owner@test.local')
    returning id into v_owner;
  insert into auth.users (id, email) values (gen_random_uuid(), 'us-owner2@test.local')
    returning id into v_owner2;
  insert into auth.users (id, email) values (gen_random_uuid(), 'us-mgr@test.local')
    returning id into v_mgr;
  insert into auth.users (id, email) values (gen_random_uuid(), 'us-doc@test.local')
    returning id into v_doc;
  insert into organizations (name, organization_type, created_by)
    values ('منشأة اختبار المستخدمين', 'clinic', v_owner) returning id into v_org;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into branches (organization_id, name) values (v_org, 'الفرع الرئيسي')
    returning id into v_branch;
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_mgr, 'branch_manager', true),
           (v_org, v_doc, 'doctor', true);

  -- ═════════════════════════════════════════════════════════════════════════
  -- 1) **لا يُزال آخر مالك**: لا بالتعطيل ولا بتغيير الدور ولا بالحذف
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    update organization_memberships set is_active = false
     where organization_id = v_org and user_id = v_owner;
    raise exception 'فشل: عُطّل آخر مالك فقُفلت المنشأة على نفسها';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%آخر مالك%' then raise; end if;
  end;

  begin
    update organization_memberships set role_key = 'doctor'
     where organization_id = v_org and user_id = v_owner;
    raise exception 'فشل: نُزعت صفة المالك عن آخر مالك';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%آخر مالك%' then raise; end if;
  end;

  begin
    delete from organization_memberships
     where organization_id = v_org and user_id = v_owner;
    raise exception 'فشل: حُذفت عضوية آخر مالك';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%آخر مالك%' then raise; end if;
  end;
  raise notice '✅ ١) آخر مالك محميّ من التعطيل وتغيير الدور والحذف';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 2) ومع وجود مالك ثانٍ يصير الأمر ممكنًا
  -- ═════════════════════════════════════════════════════════════════════════
  insert into organization_memberships (organization_id, user_id, role_key, is_active)
    values (v_org, v_owner2, 'owner', true);
  update organization_memberships set is_active = false
   where organization_id = v_org and user_id = v_owner2;
  if (select is_active from organization_memberships
       where organization_id = v_org and user_id = v_owner2) then
    raise exception 'فشل: لم يُعطَّل المالك الثاني رغم وجود مالك غيره';
  end if;
  update organization_memberships set is_active = true
   where organization_id = v_org and user_id = v_owner2;
  raise notice '✅ ٢) مع وجود مالكٍ آخر يُسمح بالتعطيل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 3) **لا ترقية للنفس**: لا صلاحيةً ولا دورًا
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    insert into membership_permissions (organization_id, user_id, permission_key, granted)
      values (v_org, v_owner, 'payroll.approve', true);
    raise exception 'فشل: منح مسؤولٌ نفسه صلاحية';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%بنفسك%' then raise; end if;
  end;

  begin
    update organization_memberships set role_key = 'organization_admin'
     where organization_id = v_org and user_id = v_owner;
    raise exception 'فشل: غيّر مسؤولٌ دور نفسه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%بنفسك%' then raise; end if;
  end;
  raise notice '✅ ٣) لا يمنح أحدٌ نفسه صلاحية ولا يغيّر دوره';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 4) منح صلاحية لعضوٍ آخر يعمل ويُوثَّق
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_set_member_permission(v_org, v_doc, 'صلاحية لا وجود لها', true);
    raise exception 'فشل: مُنحت صلاحية غير موجودة في الكتالوج';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%غير معروفة%' then raise; end if;
  end;

  perform app_set_member_permission(v_org, v_doc, 'payroll.view', true, 'يراجع مسيّرات قسمه');
  if not exists (select 1 from v_user_effective_permissions
                  where organization_id = v_org and user_id = v_doc
                    and permission_key = 'payroll.view'
                    and is_allowed and source = 'explicit_grant') then
    raise exception 'فشل: المنح الصريح لا يظهر في الصلاحيات الفعلية';
  end if;
  if not exists (select 1 from audit_log
                  where organization_id = v_org and entity_title = 'منح صلاحية') then
    raise exception 'فشل: المنح لم يدخل سجل التدقيق';
  end if;
  raise notice '✅ ٤) المنح الصريح يعمل ويظهر بمصدره ويدخل التدقيق';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 5) **المنع الصريح يغلب افتراض الدور**
  -- ═════════════════════════════════════════════════════════════════════════
  -- الطبيب يملك medical_records.view افتراضًا؛ نمنعه صراحةً
  if not exists (select 1 from v_user_effective_permissions
                  where organization_id = v_org and user_id = v_doc
                    and permission_key = 'documents.view'
                    and is_allowed and source = 'role_default') then
    raise exception 'فشل: افتراض الدور لا يظهر كمصدر';
  end if;

  perform app_set_member_permission(v_org, v_doc, 'documents.view', false, 'قرار إداري');
  if exists (select 1 from v_user_effective_permissions
              where organization_id = v_org and user_id = v_doc
                and permission_key = 'documents.view' and is_allowed) then
    raise exception 'فشل: المنع الصريح لم يغلب افتراض الدور';
  end if;

  -- وإعادتها إلى الافتراض تعيدها
  perform app_clear_member_permission(v_org, v_doc, 'documents.view');
  if not exists (select 1 from v_user_effective_permissions
                  where organization_id = v_org and user_id = v_doc
                    and permission_key = 'documents.view'
                    and is_allowed and source = 'role_default') then
    raise exception 'فشل: إعادة الصلاحية إلى الافتراض لم تعمل';
  end if;
  raise notice '✅ ٥) المنع الصريح يغلب الدور، والإعادة إلى الافتراض تعمل';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 6) المالك يظهر بكل الصلاحيات ومصدرها «إداري»
  -- ═════════════════════════════════════════════════════════════════════════
  select count(*) into v_int from v_user_effective_permissions
   where organization_id = v_org and user_id = v_owner and not is_allowed;
  if v_int > 0 then
    raise exception 'فشل: المالك ممنوع من % صلاحية', v_int;
  end if;
  if exists (select 1 from v_user_effective_permissions
              where organization_id = v_org and user_id = v_owner
                and source <> 'admin') then
    raise exception 'فشل: مصدر صلاحيات المالك ليس «إداري»';
  end if;
  raise notice '✅ ٦) المالك يظهر بكل الصلاحيات ومصدرها صفته الإدارية';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 7) العضو المعطَّل يختفي من الصلاحيات الفعلية
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_member_active(v_org, v_doc, false, 'انتهاء التعاقد');
  if exists (select 1 from v_user_effective_permissions
              where organization_id = v_org and user_id = v_doc) then
    raise exception 'فشل: العضو المعطَّل ما زالت له صلاحيات فعلية';
  end if;
  begin
    perform app_set_member_active(v_org, v_doc, false, '   ');
    raise exception 'فشل: عُطّل عضو بلا سبب';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%سبب التعطيل مطلوب%' then raise; end if;
  end;
  perform app_set_member_active(v_org, v_doc, true, null);
  raise notice '✅ ٧) التعطيل يحتاج سببًا ويقطع الصلاحيات فورًا';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 8) لا يُعطّل أحدٌ عضويته بنفسه
  -- ═════════════════════════════════════════════════════════════════════════
  begin
    perform app_set_member_active(v_org, v_owner, false, 'سبب');
    raise exception 'فشل: عطّل مسؤولٌ عضوية نفسه';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%بنفسك%' then raise; end if;
  end;
  raise notice '✅ ٨) لا يُعطّل أحدٌ عضويته بنفسه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 9) من لا يملك users.manage لا يغيّر الأدوار
  -- ═════════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  begin
    perform app_set_membership_role(v_org, v_doc, 'organization_admin');
    raise exception 'فشل: غيّر مدير الفرع دورًا بلا صلاحية إدارة المستخدمين';
  exception when others then
    if sqlerrm like 'فشل:%' then raise; end if;
    if sqlerrm not like '%users.manage%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  raise notice '✅ ٩) تغيير الأدوار محميّ بصلاحيته';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10) **تعارض المهام يظهر**: من يحتسب الرواتب ويعتمدها
  -- ═════════════════════════════════════════════════════════════════════════
  perform app_set_member_permission(v_org, v_mgr, 'payroll.run', true);
  perform app_set_member_permission(v_org, v_mgr, 'payroll.approve', true);
  if not exists (select 1 from v_duty_conflicts
                  where organization_id = v_org and user_id = v_mgr
                    and conflict_key = 'payroll') then
    raise exception 'فشل: تعارض المهام لا يظهر لمن يملك طرفَي الرواتب';
  end if;
  -- ونزع أحد الطرفين يُزيل التعارض
  perform app_set_member_permission(v_org, v_mgr, 'payroll.approve', false);
  if exists (select 1 from v_duty_conflicts
              where organization_id = v_org and user_id = v_mgr
                and conflict_key = 'payroll') then
    raise exception 'فشل: التعارض باقٍ بعد نزع أحد طرفيه';
  end if;
  raise notice '✅ ١٠) تعارض المهام يظهر ويزول بنزع أحد طرفيه';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 11) نظرة الأعضاء تعدّ المنوح والممنوع والصلاحيات الفعلية
  -- ═════════════════════════════════════════════════════════════════════════
  select allowed_count into v_int from v_members_overview
   where organization_id = v_org and user_id = v_doc;
  if coalesce(v_int, 0) = 0 then
    raise exception 'فشل: عدد صلاحيات الطبيب صفر في نظرة الأعضاء';
  end if;
  select explicit_grants into v_int from v_members_overview
   where organization_id = v_org and user_id = v_doc;
  if coalesce(v_int, 0) < 1 then
    raise exception 'فشل: المنح الصريح غير معدود';
  end if;
  raise notice '✅ ١١) نظرة الأعضاء تعدّ الصلاحيات ومصادرها';

  -- ═════════════════════════════════════════════════════════════════════════
  -- 12) عزل المنشآت
  -- ═════════════════════════════════════════════════════════════════════════
  declare v_org2 uuid; v_stranger uuid;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'us-stranger@test.local')
      returning id into v_stranger;
    insert into organizations (name, organization_type, created_by)
      values ('منشأة أخرى', 'clinic', v_stranger) returning id into v_org2;
    perform set_config('request.jwt.claim.sub', v_stranger::text, true);
    begin
      perform app_set_member_permission(v_org, v_doc, 'billing.void', true);
      raise exception 'فشل: منح غريبٌ صلاحيةً في منشأة ليست له';
    exception when others then
      if sqlerrm like 'فشل:%' then raise; end if;
      if sqlerrm not like '%users.permissions%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
  end;
  raise notice '✅ ١٢) عزل المنشآت قائم على إدارة الصلاحيات';

  raise notice '——— كل فحوص المستخدمين نجحت ———';
end $$;

rollback;
