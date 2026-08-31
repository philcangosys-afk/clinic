-- ============================================================================
-- 0095 — المرحلة 15: الأمان والتدقيق وحماية البيانات الشخصية (PDPL)
-- ============================================================================
--
-- هذه المرحلة لا تضيف ميزةً يراها المستخدم، بل تُغلق ما يُفتح بلا قصد:
-- دالّةٌ جديدة تُنشأ فتصير قابلة للاستدعاء من `anon`، ومنظورٌ يُكتب بلا
-- `security_invoker` فيتخطّى عزل المنشآت، وسجلٌّ طبيّ يُقرأ بلا أثر.
--
-- **المبدأ الحاكم**: الفحص لا يكفي مرّةً واحدة. كل فحص هنا يُثبَّت في
-- `v_security_advisor` ليُعاد تشغيله بعد كل هجرة قادمة، وما أمكن تثبيته
-- بمُحفِّز حدثٍ (event trigger) يُغلق تلقائيًّا بلا انتظار مراجعة بشرية.
--
-- **لا حذف نهائيًّا** لبيانات طبية أو مالية: سياسات الاحتفاظ هنا تُؤرشِف
-- أو تُخفي الهوية، ولا تحذف صفًّا واحدًا.
--
-- لا يوجد أيّ شيء يخصّ SMS في هذه الهجرة.
-- ============================================================================

-- ===========================================================================
-- 1) صلاحيات الأمان والخصوصية
-- ===========================================================================
insert into permission_catalog (permission_key, name_ar, module_key, display_order)
select v.k, v.n, v.m, v.o from (values
  ('insurance.submit',        'إرسال المطالبات',            'insurance', 620),
  ('insurance.settle',        'تسوية مدفوعات التأمين',      'insurance', 622),
  ('audit.view',              'عرض سجل التدقيق',            'security',  900),
  ('audit.access_log',        'عرض سجل الوصول للملف الطبي', 'security',  902),
  ('patients.view_medical',   'عرض المحتوى الطبي',          'security',  904),
  ('patients.view_financial', 'عرض بيانات المريض المالية',  'security',  906),
  ('patients.view_identity',  'عرض الهوية وبيانات التواصل', 'security',  908),
  ('privacy.consents',        'إدارة موافقات المريض',       'security',  910),
  ('privacy.retention',       'إدارة سياسات الاحتفاظ',      'security',  912)
) as v(k, n, m, o)
where not exists (select 1 from permission_catalog p where p.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  ('doctor',         'patients.view_medical'), ('doctor', 'patients.view_identity'),
  ('nurse',          'patients.view_medical'), ('nurse',  'patients.view_identity'),
  ('receptionist',   'patients.view_identity'),
  ('accountant',     'patients.view_financial'),
  ('accountant',     'insurance.submit'), ('accountant', 'insurance.settle'),
  ('branch_manager', 'patients.view_medical'), ('branch_manager', 'patients.view_identity'),
  ('branch_manager', 'patients.view_financial'), ('branch_manager', 'audit.view'),
  ('branch_manager', 'insurance.submit'), ('branch_manager', 'insurance.settle'),
  ('branch_manager', 'privacy.consents')
) as v(r, p)
where not exists (select 1 from role_default_permissions d
                   where d.role_key = v.r and d.permission_key = v.p);

-- ===========================================================================
-- 2) إغلاق `anon` على دوال SECURITY DEFINER — وإبقاؤه مغلقًا
-- ===========================================================================
--
-- دالّة `SECURITY DEFINER` تعمل بصلاحيات مالكها فتتخطّى RLS بحكم تعريفها.
-- إن بقي حقّ تنفيذها ممنوحًا لـ `public` (وهو الافتراضي في PostgreSQL)
-- صار بإمكان زائرٍ غير مسجَّل استدعاءها. الحاجز الوحيد اليوم هو أن
-- `app_has_permission` ترفض `auth.uid()` الفارغة — وهذا حاجزٌ في المنطق،
-- والمطلوب حاجزٌ في الصلاحيات.
-- الجرد الشامل يُنفَّذ في القسم 9.5 **بعد** إنشاء دوال هذه الهجرة نفسها.
-- لو نُفِّذ هنا لبقيت دوالّ الأقسام التالية مفتوحةً في أي بيئة لا يُركَّب فيها
-- مُحفِّز الأحداث — وهو ما يحدث فعلًا في Supabase المُدارة.

-- إغلاق دائم: كل دالّة `SECURITY DEFINER` تُنشأ لاحقًا تُغلق فور إنشائها،
-- فلا تعتمد السلامة على تذكُّر المبرمج في كل هجرة.
--
-- مُحفِّزات الأحداث تحتاج صلاحيةً عالية؛ إن لم تتوفّر في البيئة نكتفي
-- بالفحص في `v_security_advisor` ولا نُفشل الهجرة.
create or replace function app_guard_definer_grants()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
  loop
    if obj.object_type = 'function' then
      if exists (select 1 from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                 where p.oid = obj.objid and n.nspname = 'public' and p.prosecdef) then
        execute format('revoke all on function %s from public', obj.objid::regprocedure);
        execute format('revoke all on function %s from anon', obj.objid::regprocedure);
        execute format('grant execute on function %s to authenticated', obj.objid::regprocedure);
      end if;
    end if;
  end loop;
end $$;

do $$
begin
  begin
    drop event trigger if exists trg_guard_definer_grants;
    create event trigger trg_guard_definer_grants
      on ddl_command_end
      when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
      execute function app_guard_definer_grants();
  exception when insufficient_privilege or others then
    raise notice 'تعذّر تركيب مُحفِّز الأحداث (%). الفحص يبقى في v_security_advisor.', sqlerrm;
  end;
end $$;

-- ===========================================================================
-- 3) سجل التدقيق: الفرع، ولقطة القيم، وسبب الإجراء
-- ===========================================================================

alter table audit_log
  add column if not exists branch_id uuid references branches(id);

comment on column audit_log.branch_id is
  'فرع الحدث حين يكون السجلّ تابعًا لفرع — يُملأ تلقائيًّا من الصف المُدقَّق.';

create index if not exists idx_audit_log_branch
  on audit_log (organization_id, branch_id, occurred_at desc);

-- `app_audit_log_auto` يلتقط القيم قبل وبعد والوقت والمنشأة والمستخدم، وينقصه
-- الفرع.
--
-- كانت هذه الكتلة سابقًا **ترقّع نصّ الدالّة المخزَّن في القاعدة** بـ`replace`
-- على أسطر بعينها. وهذا خطأ في التصميم: النصّ المخزَّن يختلف من قاعدة إلى أخرى
-- بحسب آخر هجرة عُدّلت فيها الدالّة، فأيّ فرق في مسافة بادئة يُسقط الترقيع
-- ويوقف الهجرة كلّها برسالة «تغيّر نصّ الدالّة» — وهو ما وقع فعلًا على قاعدة
-- إنتاجية. الآن تُكتب الدالّة كاملةً وصراحةً: النتيجة واحدة مهما كانت النسخة
-- المخزَّنة، ولا شيء يعتمد على تنسيق نصّ سابق.
--
-- المنطق أدناه منقول حرفيًّا من 0048 (آخر نسخة معتمدة) مع إضافة الفرع وحده:
-- تخطّي حذف المنشأة، واستثناء أعمدة jsonb/المصفوفات من المقارنة (فكّ الضغط
-- كان يرفع زمن التعديل من 2.4ms إلى 1020ms)، وتجاهل التعديل الذي لا يغيّر شيئًا.
create or replace function app_audit_log_auto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec       record;
  v_title     text;
  v_action    text;
  v_details   jsonb;
  v_org       uuid;
  v_entity    uuid;
  v_diff_sql  text;
  v_branch    uuid;
begin
  v_rec := case when TG_OP = 'DELETE' then OLD else NEW end;

  execute format('select ($1).organization_id, ($1).id%s',
                 case when TG_NARGS > 0 then format(', ($1).%I::text', TG_ARGV[0]) else ', null::text' end)
    into v_org, v_entity, v_title
    using v_rec;

  -- الفرع اختياري: كثير من الجداول المُدقَّقة بلا عمود فرع، فالفشل هنا متوقَّع
  -- ولا يجوز أن يُسقط التعديل نفسه.
  begin
    execute 'select ($1).branch_id' into v_branch using v_rec;
  exception when others then
    v_branch := null;
  end;

  -- حذف المنشأة نفسها: `audit_log.organization_id` مفتاح أجنبي على
  -- `organizations` بـ `on delete cascade` (0001). أثناء الحذف المتتالي يُحذف
  -- صف المنشأة أولًا ثم أبناؤها، فيحاول هذا المُحفِّز إدراج صف تدقيق يشير إلى
  -- منشأة لم تعد موجودة — فيفشل الحذف كله بخطأ مفتاح أجنبي.
  if TG_OP = 'DELETE' and not exists (select 1 from organizations o where o.id = v_org) then
    return OLD;
  end if;

  v_action := case TG_OP when 'INSERT' then 'add' when 'UPDATE' then 'update' when 'DELETE' then 'delete' end;

  if TG_OP = 'UPDATE' then
    select string_agg(
             format($f$case when ($1).%1$I is distinct from ($2).%1$I
                       then jsonb_build_object(%2$L, jsonb_build_object(
                              'old', to_jsonb(left(($1).%1$I::text, 500)),
                              'new', to_jsonb(left(($2).%1$I::text, 500))))
                       else '{}'::jsonb end$f$, a.attname, a.attname), ' || ')
      into v_diff_sql
      from pg_attribute a
     where a.attrelid = TG_RELID
       and a.attnum > 0
       and not a.attisdropped
       -- `updated_at` يتغيّر في كل تعديل فيصبح ضجيجًا في كل سطر
       and a.attname <> 'updated_at'
       -- أعمدة jsonb/json والمصفوفات تُستثنى من المقارنة (انظر أعلاه).
       and a.atttypid not in ('jsonb'::regtype, 'json'::regtype)
       and a.attndims = 0;

    if v_diff_sql is not null then
      execute 'select ' || v_diff_sql into v_details using OLD, NEW;
      if v_details = '{}'::jsonb then v_details := null; end if;
    end if;

    -- تعديل لم يغيّر شيئًا لا يُسجَّل: مُحفِّزات قائمة تُصدر تحديثات بلا تغيير
    -- (`else status`, أو ضبط `updated_at` وحده) فكانت تدفن التعديل الحقيقي.
    if v_details is null then
      return NEW;
    end if;
  end if;

  insert into audit_log (branch_id, organization_id, user_id, action_type, module,
                         entity_id, entity_title, details, device_name)
  values (
    v_branch,
    v_org,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_entity,
    v_title,
    -- `audit_log.details` من نوع text لا jsonb (0001) — التحويل صريح حتى لا
    -- يعتمد الإدراج على تحويل ضمني قد يختلف سلوكه بين إصدارات PostgreSQL.
    v_details::text,
    app_request_device_name()
  );

  return coalesce(NEW, OLD);
end;
$$;

-- تحقّق فوريّ: الفرع صار في قائمة الأعمدة وفي قائمة القيم معًا. لو اختلّ
-- التوافق لفشل أوّل تعديل في النظام بخطأٍ لا علاقة له ظاهريًّا بالتدقيق.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'app_audit_log_auto'
         and pg_get_functiondef(p.oid) like '%branch_id, organization_id%'
         and pg_get_functiondef(p.oid) like '%v_branch,%') <> 1 then
    raise exception 'دالّة التدقيق لم تُكتب بالفرع — راجع 0095';
  end if;
end $$;

-- ===========================================================================
-- 4) سجل الوصول إلى الملف الطبي
-- ===========================================================================
--
-- PDPL تسأل «مَن اطّلع؟» لا «مَن عدّل؟». سجل التدقيق يجيب عن الثانية فقط،
-- لأن القراءة لا تُطلق مُحفِّزًا. لذلك تُسجَّل القراءة صراحةً من الواجهة
-- عند فتح ملفٍ طبيّ.
create table if not exists medical_record_access_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id       uuid references branches(id),
  patient_id      uuid not null references patients(id),
  user_id         uuid references auth.users(id),
  access_type     text not null default 'view'
                    check (access_type in ('view','print','export','download','search')),
  context         text,
  reason          text,
  visit_id        uuid references patient_visits(id),
  document_id     uuid,
  occurred_at     timestamptz not null default now()
);

comment on table medical_record_access_log is
  'سجل الاطّلاع على الملف الطبي. القراءة لا تُطلق مُحفِّزًا، فتُسجَّل صراحةً — وهذا ما تسأل عنه PDPL.';

create index if not exists idx_mral_patient
  on medical_record_access_log (organization_id, patient_id, occurred_at desc);
create index if not exists idx_mral_user
  on medical_record_access_log (organization_id, user_id, occurred_at desc);

alter table medical_record_access_log enable row level security;

create or replace function app_log_record_access(
  p_patient_id  uuid,
  p_access_type text default 'view',
  p_context     text default null,
  p_reason      text default null,
  p_visit_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_branch uuid;
  v_id     uuid;
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null then raise exception 'المريض غير موجود'; end if;
  if not app_is_member(v_org) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;

  select v.branch_id into v_branch
    from patient_visits v where v.id = p_visit_id;

  insert into medical_record_access_log (organization_id, branch_id, patient_id,
                                         user_id, access_type, context, reason, visit_id)
  values (v_org, v_branch, p_patient_id, auth.uid(),
          coalesce(p_access_type, 'view'), p_context, p_reason, p_visit_id)
  returning id into v_id;

  return v_id;
end $$;

-- ===========================================================================
-- 5) موافقات المريض — بغرضها ونسختها وسحبها
-- ===========================================================================
--
-- `patient_documents.is_consent` يحفظ **الورقة**، لا **الحالة**: لا يقول
-- هل الموافقة سارية اليوم، ولا لأي غرض، ولا متى سُحبت. وPDPL تشترط الغرض
-- وإمكان السحب. الجدول هنا يحفظ الحالة، والمستند يبقى دليلها.
create table if not exists patient_consents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  branch_id        uuid references branches(id),
  patient_id       uuid not null references patients(id),
  consent_type     text not null
                     check (consent_type in ('treatment','data_processing','data_sharing',
                                             'marketing','photography','research','telehealth')),
  purpose          text not null,
  status           text not null default 'granted'
                     check (status in ('granted','withdrawn','expired','superseded')),
  version          integer not null default 1,
  granted_at       timestamptz not null default now(),
  granted_by       uuid references auth.users(id),
  expires_at       timestamptz,
  withdrawn_at     timestamptz,
  withdrawn_by     uuid references auth.users(id),
  withdrawal_reason text,
  document_id      uuid references patient_documents(id),
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table patient_consents is
  'موافقات المريض بحالتها وغرضها ونسختها. **لا تُحذف موافقة مسحوبة** — تبقى شاهدًا على أن السحب حدث ومتى.';

-- موافقة سارية واحدة لكل غرض: بلا هذا تتراكم موافقات متناقضة ولا يُعرف
-- أيّها المعمول به.
create unique index if not exists uq_active_consent
  on patient_consents (patient_id, consent_type)
  where status = 'granted';

create index if not exists idx_consents_patient
  on patient_consents (organization_id, patient_id, consent_type);

alter table patient_consents enable row level security;

create or replace function app_record_patient_consent(
  p_patient_id   uuid,
  p_consent_type text,
  p_purpose      text,
  p_expires_at   timestamptz default null,
  p_document_id  uuid default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_id      uuid;
  v_version integer;
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null then raise exception 'المريض غير موجود'; end if;
  if not app_has_permission(v_org, 'privacy.consents') then
    raise exception 'صلاحيتك لا تسمح بتسجيل الموافقات (privacy.consents)';
  end if;
  if coalesce(trim(p_purpose), '') = '' then
    raise exception 'الغرض من الموافقة مطلوب — موافقةٌ بلا غرض لا تصلح سندًا';
  end if;

  -- الموافقة السابقة تُصبح «مستبدَلة» ولا تُحذف
  select coalesce(max(version), 0) + 1 into v_version
    from patient_consents
   where patient_id = p_patient_id and consent_type = p_consent_type;

  update patient_consents
     set status = 'superseded', updated_at = now()
   where patient_id = p_patient_id and consent_type = p_consent_type
     and status = 'granted';

  insert into patient_consents (organization_id, patient_id, consent_type, purpose,
                                version, granted_by, expires_at, document_id, note)
  values (v_org, p_patient_id, p_consent_type, p_purpose,
          v_version, auth.uid(), p_expires_at, p_document_id, p_note)
  returning id into v_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_org, auth.uid(), 'privacy', 'add', v_id, 'موافقة مريض',
          format('موافقة %s نسخة %s', p_consent_type, v_version), p_purpose);

  return v_id;
end $$;

create or replace function app_withdraw_patient_consent(
  p_consent_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c patient_consents%rowtype;
begin
  select * into v_c from patient_consents where id = p_consent_id for update;
  if v_c.id is null then raise exception 'الموافقة غير موجودة'; end if;
  if not app_has_permission(v_c.organization_id, 'privacy.consents') then
    raise exception 'صلاحيتك لا تسمح بسحب الموافقات (privacy.consents)';
  end if;
  if v_c.status <> 'granted' then
    raise exception 'الموافقة ليست سارية (حالتها %)', v_c.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'سبب السحب مطلوب';
  end if;

  update patient_consents
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(),
         withdrawal_reason = p_reason, updated_at = now()
   where id = p_consent_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_c.organization_id, auth.uid(), 'privacy', 'update', p_consent_id,
          'سحب موافقة', format('سُحبت موافقة %s', v_c.consent_type), p_reason);
end $$;

-- الموافقة السارية فعلًا: غير منتهية وغير مسحوبة
create or replace function app_has_patient_consent(
  p_patient_id   uuid,
  p_consent_type text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from patient_consents
     where patient_id = p_patient_id
       and consent_type = p_consent_type
       and status = 'granted'
       and (expires_at is null or expires_at > now()));
$$;

-- ===========================================================================
-- 6) سياسات الاحتفاظ والأرشفة — بلا حذف
-- ===========================================================================
create table if not exists data_retention_policies (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  entity_key       text not null
                     check (entity_key in ('patient_records','appointments','audit_log',
                                           'access_log','documents','messages','invoices')),
  retention_months integer not null check (retention_months >= 1),
  action_on_expiry text not null default 'archive'
                     check (action_on_expiry in ('archive','anonymize','review')),
  legal_basis      text not null,
  is_active        boolean not null default true,
  last_run_at      timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id)
);

comment on table data_retention_policies is
  'سياسات الاحتفاظ. `action_on_expiry` لا يتضمّن الحذف: البيانات الطبية والمالية تُؤرشَف أو تُخفى هويّتها، ولا تُمحى.';

-- سياسة واحدة سارية لكل نوع بيانات في المنشأة
create unique index if not exists uq_retention_entity
  on data_retention_policies (organization_id, entity_key)
  where is_active;

alter table data_retention_policies enable row level security;

-- **حارس صريح**: لو أُضيف يومًا خيارُ حذفٍ إلى القائمة، يفشل الإدراج هنا
-- بدل أن يمرّ صامتًا.
create or replace function app_guard_retention_action()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.action_on_expiry in ('delete','purge','erase') then
    raise exception 'الحذف النهائي غير مسموح لسياسات الاحتفاظ — استخدم الأرشفة أو إخفاء الهوية';
  end if;
  if coalesce(trim(new.legal_basis), '') = '' then
    raise exception 'السند النظامي للاحتفاظ مطلوب';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- تقدير أثر السياسة قبل تطبيقها — **إحصاء لا تعديل**.
--
-- الأرشفة الفعلية تختلف بين نوع بيانات وآخر (الملف الطبي يُؤرشَف، والموعد
-- يُخفى صاحبه، والفاتورة لا تُمَسّ)، فتُنفَّذ كلٌّ في مرحلتها. ما يلزم اليوم
-- هو أن يرى المشغّل **حجم ما تجاوز المدّة** قبل أن يقرّر، وأن يُختم وقت آخر
-- مراجعة. هذه الدالّة لا تحذف ولا تعدّل صفًّا واحدًا من البيانات.
create or replace function app_apply_retention_policy(p_policy_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p      data_retention_policies%rowtype;
  v_cutoff timestamptz;
  v_count  integer := 0;
begin
  select * into v_p from data_retention_policies where id = p_policy_id for update;
  if v_p.id is null then raise exception 'السياسة غير موجودة'; end if;
  if not app_has_permission(v_p.organization_id, 'privacy.retention') then
    raise exception 'صلاحيتك لا تسمح بتشغيل سياسات الاحتفاظ (privacy.retention)';
  end if;

  v_cutoff := now() - make_interval(months => v_p.retention_months);

  v_count := case v_p.entity_key
    when 'patient_records' then
      (select count(*) from patient_visits
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    when 'appointments' then
      (select count(*) from appointments
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    when 'audit_log' then
      (select count(*) from audit_log
        where organization_id = v_p.organization_id and occurred_at < v_cutoff)
    when 'access_log' then
      (select count(*) from medical_record_access_log
        where organization_id = v_p.organization_id and occurred_at < v_cutoff)
    when 'documents' then
      (select count(*) from patient_documents
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    when 'messages' then
      (select count(*) from internal_messages
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    when 'invoices' then
      (select count(*) from sales_invoices
        where organization_id = v_p.organization_id and created_at < v_cutoff)
    else 0
  end;

  update data_retention_policies
     set last_run_at = now(), updated_at = now(), updated_by = auth.uid()
   where id = p_policy_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details, reason)
  values (v_p.organization_id, auth.uid(), 'privacy', 'update', p_policy_id,
          'مراجعة سياسة احتفاظ',
          format('%s سجلًّا تجاوز %s شهرًا (إجراء: %s)',
                 v_count, v_p.retention_months, v_p.action_on_expiry),
          v_p.legal_basis);

  return v_count;
end $$;

drop trigger if exists trg_guard_retention_action on data_retention_policies;
create trigger trg_guard_retention_action
  before insert or update on data_retention_policies
  for each row execute function app_guard_retention_action();

-- ===========================================================================
-- 7) إخفاء البيانات حسب الدور
-- ===========================================================================
--
-- الإخفاء يقع في **القاعدة** لا في الواجهة: واجهةٌ تُخفي حقلًا وتُنزّله في
-- الاستجابة لم تُخفِ شيئًا — من يفتح أدوات المطوّر يقرؤه.
create or replace function app_mask_text(p_value text, p_keep integer default 4)
returns text
language sql
immutable
as $$
  select case
    when p_value is null or length(p_value) = 0 then null
    when length(p_value) <= p_keep then repeat('•', length(p_value))
    else repeat('•', length(p_value) - p_keep) || right(p_value, p_keep)
  end;
$$;

drop view if exists v_patient_directory;
create view v_patient_directory
with (security_invoker = on) as
select
  p.id,
  p.organization_id,
  p.branch_id,
  p.name_ar,
  p.name_en,
  p.file_number,
  p.gender,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.id_number else app_mask_text(p.id_number) end       as id_number,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.phone_1  else app_mask_text(p.phone_1)  end         as phone_1,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.email_1  else app_mask_text(p.email_1, 0) end       as email_1,
  case when app_has_permission(p.organization_id, 'patients.view_identity')
       then p.birth_date else null end                            as birth_date,
  -- العمر يبقى ظاهرًا لأنه ضرورة سريرية، والتاريخ الدقيق معرّف شخصي
  case when p.birth_date is not null
       then extract(year from age(p.birth_date))::int end         as age_years,
  app_has_permission(p.organization_id, 'patients.view_identity') as identity_visible,
  app_has_permission(p.organization_id, 'patients.view_medical')  as medical_visible,
  app_has_permission(p.organization_id, 'patients.view_financial') as financial_visible,
  p.created_at
from patients p;

comment on view v_patient_directory is
  'دليل المرضى بإخفاءٍ حسب الدور. الإخفاء في القاعدة لا في الواجهة — ما تُخفيه الواجهة يبقى في الاستجابة.';

-- ===========================================================================
-- 8) RLS للجداول الجديدة
-- ===========================================================================
do $$
declare
  r record;
  pol record;
begin
  for r in select unnest(array['medical_record_access_log','patient_consents',
                               'data_retention_policies']) as t
  loop
    -- الحذف بالبحث لا بتخمين الاسم: أسماء السياسات تختلف بين البيئات
    for pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = r.t
    loop
      execute format('drop policy %I on %I', pol.policyname, r.t);
    end loop;

    execute format($f$
      create policy %1$I on %2$I for select to authenticated
        using (app_is_member(organization_id))
    $f$, r.t || '_select', r.t);

    execute format($f$
      create policy %1$I on %2$I for insert to authenticated
        with check (app_is_member(organization_id))
    $f$, r.t || '_insert', r.t);

    execute format($f$
      create policy %1$I on %2$I for update to authenticated
        using (app_is_member(organization_id))
        with check (app_is_member(organization_id))
    $f$, r.t || '_update', r.t);
  end loop;
end $$;

-- **سجل الوصول لا يُعدَّل ولا يُحذف.** سجلٌّ يمكن تعديله ليس سجلًّا.
create or replace function app_block_access_log_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'سجل الوصول للملف الطبي لا يُعدَّل ولا يُحذف';
end $$;

drop trigger if exists trg_block_access_log_change on medical_record_access_log;
create trigger trg_block_access_log_change
  before update or delete on medical_record_access_log
  for each row execute function app_block_access_log_change();

grant select on v_patient_directory to authenticated;
grant select, insert on medical_record_access_log to authenticated;
grant select, insert, update on patient_consents to authenticated;
grant select, insert, update on data_retention_policies to authenticated;

-- ===========================================================================
-- 9) جرد شامل: إغلاق كل دالّة SECURITY DEFINER أمام anon
-- ===========================================================================
--
-- يُنفَّذ هنا لا في القسم 2، ليشمل دوال هذه الهجرة نفسها في البيئات التي
-- لا يُركَّب فيها مُحفِّز الأحداث.
do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    -- دوال مُحفِّزات الأحداث لا تُستدعى مباشرةً، فلا تُمنح لأحد
    if (select p.prorettype from pg_proc p where p.oid = r.sig::oid)
       <> 'event_trigger'::regtype then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    v_count := v_count + 1;
  end loop;
  raise notice 'أُغلق % دالّة SECURITY DEFINER أمام anon', v_count;
end $$;

-- ===========================================================================
-- 9.5) مستشار الأمان — يُعاد تشغيله بعد كل هجرة
-- ===========================================================================
--
-- بديلٌ محليّ عن Security/Performance Advisors في Supabase: يفحص نفس
-- العائلات ويبقى داخل المشروع فيُشغَّل في أي بيئة.
drop view if exists v_security_advisor;
create view v_security_advisor
with (security_invoker = on) as
-- جدول بلا RLS
select 'rls_disabled'::text as finding_type,
       'خطر'::text          as severity,
       c.relname::text      as object_name,
       'جدول بلا RLS — أي مستخدم مسجَّل يقرأ كل المنشآت'::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
union all
-- RLS مفعّلة بلا سياسات = منع كامل (غالبًا سهو)
select 'rls_no_policy', 'تحذير', c.relname::text,
       'RLS مفعّلة بلا سياسة — الجدول محجوب كليًّا عن المستخدمين'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
   and not exists (select 1 from pg_policies pp
                    where pp.schemaname = 'public' and pp.tablename = c.relname)
union all
-- دالّة SECURITY DEFINER بلا search_path مثبَّت
select 'definer_no_search_path', 'خطر', p.proname::text,
       'دالّة SECURITY DEFINER بلا search_path مثبَّت — عرضة لاختطاف المسار'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
union all
-- دالّة SECURITY DEFINER ما زالت مفتوحة لـ anon
select 'definer_anon_execute', 'خطر', p.proname::text,
       'دالّة SECURITY DEFINER قابلة للاستدعاء من anon — تتخطّى RLS بلا مستخدم'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('anon', p.oid, 'execute')
union all
-- منظور بلا security_invoker: يقرأ بصلاحيات مالكه فيتخطّى العزل
select 'view_no_invoker', 'خطر', c.relname::text,
       'منظور بلا security_invoker — يقرأ بصلاحيات مالكه ويتخطّى عزل المنشآت'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v'
   and c.relname like 'v\_%'
   and coalesce(c.reloptions::text, '') not like '%security_invoker=on%'
union all
-- سياسة على جدول له organization_id لا تذكر العزل ولا تستعمل دالّة عضوية
select 'policy_without_org_scope', 'تحذير', pp.tablename::text,
       format('سياسة %s لا تذكر organization_id ولا دالّة عضوية', pp.policyname)
  from pg_policies pp
 where pp.schemaname = 'public'
   and exists (select 1 from information_schema.columns col
                where col.table_schema = 'public' and col.table_name = pp.tablename
                  and col.column_name = 'organization_id')
   and coalesce(pp.qual, '') || coalesce(pp.with_check, '') not like '%organization_id%'
   and coalesce(pp.qual, '') || coalesce(pp.with_check, '') not like '%app_is_%'
   and coalesce(pp.qual, '') || coalesce(pp.with_check, '') not like '%app_has_%'
union all
-- أداء: مفتاح أجنبي بلا فهرس يغطّيه — كل حذف في الأب يمسح الابن كاملًا.
--
-- **يُبلَّغ عنه للجداول الكبيرة فقط** (أكثر من ألف صفّ تقديريًّا). المخطّط
-- فيه مئات المفاتيح الأجنبية على جداول مرجعية صغيرة، والإبلاغ عنها كلّها
-- يُغرق التقرير في ضجيج يُخفي النتائج الأمنية التي تهمّ.
select 'fk_without_index', 'أداء',
       (con.conrelid::regclass)::text,
       format('مفتاح أجنبي %s بلا فهرس على جدول بـ %s صفّ تقديريًّا',
              con.conname, c.reltuples::bigint)
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where con.contype = 'f' and n.nspname = 'public'
   and c.reltuples > 1000
   and not exists (
     select 1 from pg_index i
      where i.indrelid = con.conrelid
        and con.conkey <@ (select array_agg(k) from unnest(i.indkey::int2[]) k));

comment on view v_security_advisor is
  'مستشار أمان وأداء محليّ: RLS والمسارات وanon والمناظير والعزل والفهارس الناقصة. يُقرأ بعد كل هجرة.';

-- **لا يُمنح للمستخدمين.** قائمةُ الجداول التي تنقصها RLS خارطةُ هجوم جاهزة
-- لمن يقرؤها؛ هذا المنظور أداةُ مشغّل تُقرأ من محرّر SQL أو خدمة خلفية.
revoke all on v_security_advisor from authenticated, anon;

-- ===========================================================================
-- 10) فحص ذاتي — يفشل عند أي خرق أمنيّ من الفئات الحرجة
-- ===========================================================================
do $$
declare
  v_n int;
  v_list text;
begin
  select count(*), string_agg(object_name, ', ')
    into v_n, v_list
    from v_security_advisor
   where finding_type in ('rls_disabled','definer_no_search_path','definer_anon_execute');
  if v_n > 0 then
    raise exception 'خروق أمنية حرجة (%): %', v_n, left(v_list, 500);
  end if;

  select count(*), string_agg(object_name, ', ')
    into v_n, v_list
    from v_security_advisor where finding_type = 'view_no_invoker';
  if v_n > 0 then
    raise exception 'مناظير بلا security_invoker (%): %', v_n, left(v_list, 500);
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'audit_log'
                    and column_name = 'branch_id') then
    raise exception 'سجل التدقيق بلا فرع';
  end if;

  if not exists (select 1 from pg_indexes where indexname = 'uq_active_consent') then
    raise exception 'لا حارس لتعدّد الموافقات السارية';
  end if;
end $$;
