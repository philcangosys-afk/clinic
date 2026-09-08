-- =============================================================================
-- 0149_adopt_orphan_objects.sql
-- تبنّي الكائنات اليتيمة: ما يعمل في الإنتاج ولا يُنشئه أيّ ملفّ في المستودع.
-- =============================================================================
--
-- **العيب الذي تعالجه هذه الترقية:** فحصُ 160 ملفّ SQL في `migrations/` و
-- `supabase/migrations/` أثبت أنّ ستّة كائنات تعمل في قاعدة الإنتاج ولا
-- `create table` ولا `create view` لأيٍّ منها في المستودع:
--
--   custom_reports · document_templates · generated_documents ·
--   external_clients · occupational_exam_results · v_occupational_exam_report
--
-- ومع ذلك تبني عليها ترقيات قائمة: `0061` تُدرج في `occupational_exam_results`،
-- و`0072` فيها `references external_clients(id)` **داخل `create table`**،
-- و`0102` تُضيف أعمدة تشير إلى `document_templates` و`generated_documents`
-- وتقرؤهما في دوالّها، و`0051` تُنفّذ `alter view v_occupational_exam_report`،
-- و`0148` تُضيف لها مفاتيح ربط.
--
-- **الأثر:** السلسلة `0001 → 0148` **لا تستطيع بناء القاعدة من الصفر** — البناء
-- النظيف يتوقّف عند `0072` بخطأ `relation "external_clients" does not exist`.
-- وإن فُقد أحد هذه الكائنات من الإنتاج فلا مصدر يُستعاد منه. أُنشئت خارج
-- الترقيات (محرّر Supabase على الأرجح).
--
-- **ماذا تفعل هذه الترقية على قاعدتك؟ لا شيء.** كل عبارة فيها محروسة بـ
-- `if not exists`، والتعريفات منسوخة حرفيًّا من إنتاجك عبر `pg_get_constraintdef`
-- و`pg_indexes` و`pg_policies` و`pg_get_viewdef`. قيمتها كلّها في البناء النظيف:
-- بعدها تستطيع السلسلة أن تبني نسخة مطابقة من الصفر، وهو شرط أيّ اختبار موثوق.
--
-- ملاحظة: ترتيب هذه الترقية رقمها 0149 لكنّ الكائنات التي تُنشئها **سابقة** لها
-- منطقيًّا. على قاعدةٍ قائمة لا فرق (الحُرّاس تتخطّاها). وعلى بناءٍ نظيف من
-- الصفر يجب تنفيذها **قبل** `0051` و`0061` و`0072` و`0102`؛ وثِّق ذلك في
-- `docs/HANDOVER.md` §٩ عند إعادة بناء القاعدة المرجعية.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) custom_reports — التقارير المخصّصة التي يبنيها المستخدم
-- -----------------------------------------------------------------------------
create table if not exists custom_reports (
  id                 uuid        not null default gen_random_uuid(),
  organization_id    uuid        not null,
  name               text        not null,
  source_key         text        not null,
  selected_fields    text[]      not null default '{}'::text[],
  filters            jsonb       not null default '[]'::jsonb,
  group_by_field     text,
  aggregation        text,
  aggregation_field  text,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint custom_reports_pkey primary key (id),
  constraint custom_reports_aggregation_check
    check (aggregation = any (array['count'::text, 'sum'::text])),
  constraint custom_reports_created_by_fkey
    foreign key (created_by) references auth.users(id),
  constraint custom_reports_organization_id_fkey
    foreign key (organization_id) references organizations(id) on delete cascade
);

create index if not exists idx_custom_reports_org
  on custom_reports using btree (organization_id);

alter table custom_reports enable row level security;


-- -----------------------------------------------------------------------------
-- 2) document_templates — قوالب المستندات
--    قالب بلا منشأة (organization_id is null) قالبٌ عامّ يقرؤه الجميع
--    ولا يعدّله إلّا مدير منشأة — وهذا سبب اختلاف سياساته عن البقيّة.
-- -----------------------------------------------------------------------------
create table if not exists document_templates (
  id                 uuid        not null default gen_random_uuid(),
  organization_id    uuid,
  category_value_id  uuid,
  name_ar            text        not null,
  name_en            text,
  applies_to         text        not null default 'generic'::text,
  body_html          text        not null default ''::text,
  note               text,
  is_disabled        boolean     not null default false,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  system_key         text,
  constraint document_templates_pkey primary key (id),
  constraint document_templates_applies_to_check
    check (applies_to = any (array['patient'::text, 'employee'::text, 'generic'::text])),
  constraint document_templates_category_value_id_fkey
    foreign key (category_value_id) references lookup_values(id),
  constraint document_templates_created_by_fkey
    foreign key (created_by) references auth.users(id),
  constraint document_templates_organization_id_fkey
    foreign key (organization_id) references organizations(id) on delete cascade
);

create index if not exists idx_document_templates_org
  on document_templates using btree (organization_id);

-- المفتاح النظاميّ فريد حين يوجد فقط — القوالب اليدوية بلا مفتاح
create unique index if not exists uq_document_templates_system_key
  on document_templates using btree (system_key)
  where (system_key is not null);

alter table document_templates enable row level security;


-- -----------------------------------------------------------------------------
-- 3) generated_documents — المستندات المُصدَرة من القوالب
--    `template_name_snapshot` لقطة اسم القالب وقت الإصدار: المستند الصادر
--    لا يتغيّر إن أُعيدت تسمية قالبه أو حُذف.
-- -----------------------------------------------------------------------------
create table if not exists generated_documents (
  id                     uuid        not null default gen_random_uuid(),
  organization_id        uuid        not null,
  template_id            uuid,
  template_name_snapshot text        not null,
  patient_id             uuid,
  employee_id            uuid,
  title                  text        not null,
  body_html              text        not null,
  extra_fields           jsonb       not null default '{}'::jsonb,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  constraint generated_documents_pkey primary key (id),
  constraint generated_documents_created_by_fkey
    foreign key (created_by) references auth.users(id),
  constraint generated_documents_employee_id_fkey
    foreign key (employee_id) references employees(id) on delete set null,
  constraint generated_documents_organization_id_fkey
    foreign key (organization_id) references organizations(id) on delete cascade,
  constraint generated_documents_patient_id_fkey
    foreign key (patient_id) references patients(id) on delete set null,
  constraint generated_documents_template_id_fkey
    foreign key (template_id) references document_templates(id) on delete set null
);

create index if not exists idx_generated_documents_org
  on generated_documents using btree (organization_id);

create index if not exists idx_generated_documents_patient
  on generated_documents using btree (patient_id)
  where (patient_id is not null);

create index if not exists idx_generated_documents_employee
  on generated_documents using btree (employee_id)
  where (employee_id is not null);

alter table generated_documents enable row level security;


-- -----------------------------------------------------------------------------
-- 4) external_clients — العملاء الخارجيون (جهات تُفوتَر بلا ملفّ مريض)
--    القيد الفريد (organization_id, id) ليس زائدًا: هو طرف المفتاح المركّب
--    الذي تعتمد عليه `price_lists` في `0077` و`0148` لعزل المنشآت.
-- -----------------------------------------------------------------------------
create table if not exists external_clients (
  id               uuid        not null default gen_random_uuid(),
  organization_id  uuid        not null,
  name             text        not null,
  mobile_1         text,
  mobile_2         text,
  phone_1          text,
  phone_2          text,
  registered_at    timestamptz not null default now(),
  note             text,
  is_disabled      boolean     not null default false,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint external_clients_pkey primary key (id),
  constraint external_clients_organization_id_id_key unique (organization_id, id),
  constraint external_clients_created_by_fkey
    foreign key (created_by) references auth.users(id),
  constraint external_clients_organization_id_fkey
    foreign key (organization_id) references organizations(id) on delete cascade
);

create index if not exists idx_external_clients_org
  on external_clients using btree (organization_id);

create unique index if not exists uq_external_clients_org_id
  on external_clients using btree (organization_id, id);

alter table external_clients enable row level security;


-- -----------------------------------------------------------------------------
-- 5) occupational_exam_results — نتائج الفحص المهنيّ
--    `visit_id` فريد: فحص مهنيّ واحد لكل زيارة، لا يتكرّر.
--    هذا هو الجدول الذي يقرؤه `v_occupational_exam_report`، فيجب أن يسبقه.
-- -----------------------------------------------------------------------------
create table if not exists occupational_exam_results (
  id                  uuid        not null default gen_random_uuid(),
  organization_id     uuid        not null,
  patient_id          uuid        not null,
  visit_id            uuid        not null,
  exam_purpose        text        not null default 'periodic'::text,
  fitness_status      text        not null default 'pending'::text,
  employer_value_id   uuid,
  restrictions_note   text,
  certificate_number  text,
  exam_date           date        not null default current_date,
  next_exam_due_date  date,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint occupational_exam_results_pkey primary key (id),
  constraint occupational_exam_results_visit_id_key unique (visit_id),
  constraint occupational_exam_results_exam_purpose_check
    check (exam_purpose = any (array['pre_employment'::text, 'periodic'::text,
                                     'return_to_work'::text, 'exit'::text])),
  constraint occupational_exam_results_fitness_status_check
    check (fitness_status = any (array['fit'::text, 'fit_with_restrictions'::text,
                                       'unfit'::text, 'pending'::text])),
  constraint occupational_exam_results_created_by_fkey
    foreign key (created_by) references auth.users(id),
  constraint occupational_exam_results_employer_value_id_fkey
    foreign key (employer_value_id) references lookup_values(id),
  constraint occupational_exam_results_organization_id_fkey
    foreign key (organization_id) references organizations(id) on delete cascade,
  constraint occupational_exam_results_patient_id_fkey
    foreign key (patient_id) references patients(id) on delete cascade,
  constraint occupational_exam_results_visit_id_fkey
    foreign key (visit_id) references patient_visits(id) on delete cascade
);

create index if not exists idx_occupational_exam_org_date
  on occupational_exam_results using btree (organization_id, exam_date desc);

-- الفحوص المستحقّة: الفهرس جزئيّ لأنّ أغلب الصفوف بلا موعد تجديد
create index if not exists idx_occupational_exam_due
  on occupational_exam_results using btree (organization_id, next_exam_due_date)
  where (next_exam_due_date is not null);

create index if not exists idx_occupational_exam_employer
  on occupational_exam_results using btree (organization_id, employer_value_id)
  where (employer_value_id is not null);

alter table occupational_exam_results enable row level security;


-- -----------------------------------------------------------------------------
-- 6) السياسات — منسوخة حرفيًّا من `pg_policies` في الإنتاج
--    `create policy` لا تقبل `if not exists`، فتُحرَس بالفحص.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'custom_reports'
                    and policyname = 'custom_reports_all_members') then
    create policy custom_reports_all_members on custom_reports
      for all to public
      using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'external_clients'
                    and policyname = 'external_clients_all_members') then
    create policy external_clients_all_members on external_clients
      for all to public
      using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'generated_documents'
                    and policyname = 'generated_documents_all_members') then
    create policy generated_documents_all_members on generated_documents
      for all to public
      using (app_is_member(organization_id))
      with check (app_is_member(organization_id));
  end if;

  -- القوالب: القراءة تشمل القوالب العامّة، والكتابة لمدير المنشأة وحده
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'document_templates'
                    and policyname = 'document_templates_read_members') then
    create policy document_templates_read_members on document_templates
      for select to public
      using ((organization_id is null) or app_is_member(organization_id));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'document_templates'
                    and policyname = 'document_templates_insert_admins') then
    create policy document_templates_insert_admins on document_templates
      for insert to public
      with check ((organization_id is not null) and app_is_org_admin(organization_id));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'document_templates'
                    and policyname = 'document_templates_update_admins') then
    create policy document_templates_update_admins on document_templates
      for update to public
      using ((organization_id is not null) and app_is_org_admin(organization_id));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'document_templates'
                    and policyname = 'document_templates_delete_admins') then
    create policy document_templates_delete_admins on document_templates
      for delete to public
      using ((organization_id is not null) and app_is_org_admin(organization_id));
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 7) المنظور — تعريفه منسوخ حرفيًّا من `pg_get_viewdef` في الإنتاج
--    يُنشأ فقط إن غاب، فلا يُستبدل منظور قائم.
--    `security_invoker` مطلوب لأنّ `0051` تفرضه على هذا المنظور.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public'
                   and c.relname = 'v_occupational_exam_report') then
    execute $v$
      create view v_occupational_exam_report
      with (security_invoker = on) as
      select oer.id,
             oer.organization_id,
             oer.visit_id,
             oer.patient_id,
             p.name_ar        as patient_name,
             p.file_number    as patient_file_number,
             pv.doctor_id,
             d.name_ar        as doctor_name,
             oer.exam_purpose,
             oer.fitness_status,
             oer.employer_value_id,
             lv.name_ar       as employer_name,
             oer.restrictions_note,
             oer.certificate_number,
             oer.exam_date,
             oer.next_exam_due_date,
             p.id_number      as patient_id_number,
             p.mobile_number  as patient_mobile_number
        from occupational_exam_results oer
        join patients p        on p.id  = oer.patient_id
        left join patient_visits pv on pv.id = oer.visit_id
        left join doctors d        on d.id  = pv.doctor_id
        left join lookup_values lv on lv.id = oer.employer_value_id
    $v$;
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 8) تحديث ذاكرة مخطّط PostgREST
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
