-- ============================================================================
-- 0145 — الأحد عشر الباقية: ما لا يُصلَح إلّا في القاعدة
--
-- أربعة أجزاء، كلٌّ منها جذرُ ملاحظة قاتلة:
--   1) نماذج الفحص: مصدران متنازعان لتعريف النموذج الواحد.
--   2) الإجازة المعتمدة لا تصل الحضور.
--   3) صرف راتب فرديّ بالإجمالي وبلا حدّ.
--   4) الدواء المصروف لا يصل الفوترة.
-- ============================================================================

begin;

-- ════════════════════════════════════════════════════════════════════════
-- 1) نماذج الفحص: مصدر واحد للتعريف
--
--    المشكلة المُثبَتة: النموذج له تعريفان.
--      • `clinic_exam_templates.schema_definition` — يقرؤه نموذج الزيارة،
--        وفيه القسم `{key, label_ar, type, fields: ["heart_rate", ...]}` أي
--        **مفاتيح نصّية**.
--      • جدولا `exam_template_sections`/`exam_template_fields` — يقرؤهما
--        مصمّم النماذج، وهما **فارغان تمامًا** لكل القوالب الواحد والعشرين.
--    ومُحفِّز `app_rebuild_exam_schema` يُعيد بناء `schema_definition` من
--    الجدولين. فالنتيجة ثلاث ملاحظات قاتلة متصلة:
--      • تبويب «البناء» فارغ أبدًا، والقالب المُنشأ من الشاشة لا يصل الطبيب.
--      • أوّل قسم يُضاف يُشغّل المُحفِّز فيستبدل النموذج القائم بقسمٍ واحد —
--        أي يمحو نموذج الفحص كلّه.
--      • والشكل المُعاد بناؤه يجعل `fields` **كائنات** لا نصوصًا، فتنكسر شاشة
--        الزيارة التي تقرأ نصوصًا.
--
--    العلاج: الجدولان هما المصدر، و`schema_definition` نسخةٌ مُولَّدة منهما.
--    ولذلك ثلاث خطوات: عمود نوع القسم (فالقسم قد يكون نصًّا أو تشخيصًا لا
--    مجموعة حقول)، ثم ترحيل التعريف القديم إلى الجدولين حرفًا بحرف، ثم دالّة
--    بناء تُخرِج الشكل الموحَّد. والواجهة تقبل الشكلين (نصّ أو كائن) فلا ينكسر
--    قالبٌ لم يُرحَّل بعد.
-- ════════════════════════════════════════════════════════════════════════

alter table exam_template_sections
  add column if not exists section_type text not null default 'group';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'exam_template_sections'::regclass
       and conname = 'exam_template_sections_type_check'
  ) then
    alter table exam_template_sections
      add constraint exam_template_sections_type_check
      check (section_type in ('group', 'text', 'textarea', 'diagnosis'));
  end if;
end $$;

-- تسميات حقول القوالب القديمة. التعريف القديم يحفظ المفاتيح بلا تسميات،
-- والتسميات كانت في الواجهة وحدها — فتُنقل إلى القاعدة مع البيانات.
create or replace function app_legacy_exam_field_label(p_key text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select x.label from (values
      ('heart_rate', 'معدل النبض'),
      ('blood_pressure', 'ضغط الدم'),
      ('temperature', 'الحرارة'),
      ('glucose_level', 'السكر'),
      ('height', 'الطول (سم)'),
      ('weight', 'الوزن (كجم)'),
      ('bmi', 'مؤشر كتلة الجسم'),
      ('respiratory_rate', 'معدل التنفس'),
      ('head_neck', 'الرأس والرقبة'),
      ('chest', 'الصدر'),
      ('abdomen', 'البطن'),
      ('upper_limbs', 'الأطراف العلوية'),
      ('lower_limbs', 'الأطراف السفلية'),
      ('reflection', 'المنعكسات'),
      ('heart', 'القلب'),
      ('nervous_system', 'الجهاز العصبي'),
      ('free_exam', 'فحص حر'),
      ('vision_test', 'فحص النظر'),
      ('hearing_test', 'فحص السمع'),
      ('musculoskeletal', 'الجهاز العضلي الهيكلي')
    ) as x(key, label) where x.key = p_key),
    p_key
  );
$$;

-- القوالب الواحد والعشرون كلّها **نظامية** (بلا منشأة)، وجدولا البناء
-- محميّان بعضوية المنشأة — فلا يمكن أن يكون لقالب نظاميّ أقسامٌ أصلًا، ولا
-- يجوز أن يُعدّله عضوٌ في منشأة فيتغيّر على كل المنشآت. فالتخصيص نسخةٌ
-- للمنشأة، والنسخ يبني الأقسام والحقول من التعريف القديم دفعةً واحدة.
create or replace function app_clone_exam_template(
  p_template_id uuid,
  p_organization_id uuid,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src     clinic_exam_templates%rowtype;
  v_new     uuid;
  v_section jsonb;
  v_field   text;
  v_sec_id  uuid;
  v_order   int := 0;
  v_forder  int;
begin
  if not app_has_permission(p_organization_id, 'exam_templates.manage') then
    raise exception 'صلاحيتك لا تسمح بإدارة نماذج الفحص (exam_templates.manage)';
  end if;
  select * into v_src from clinic_exam_templates where id = p_template_id;
  if v_src.id is null then
    raise exception 'القالب غير موجود';
  end if;
  if v_src.organization_id is not null and v_src.organization_id <> p_organization_id then
    raise exception 'لا يُنسخ قالب منشأة أخرى';
  end if;

  insert into clinic_exam_templates (organization_id, specialty_code, name_ar, name_en,
                                     note, canvas_type, schema_definition, specialty_value_id,
                                     clinic_id, version, parent_template_id, description_ar,
                                     created_by)
  values (p_organization_id, v_src.specialty_code,
          coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_src.name_ar || ' — نسخة المنشأة'),
          v_src.name_en, v_src.note, v_src.canvas_type, v_src.schema_definition,
          v_src.specialty_value_id, v_src.clinic_id, 1, v_src.id, v_src.description_ar,
          auth.uid())
  returning id into v_new;

  -- الأقسام والحقول من التعريف القديم: القالب النظاميّ يحفظ مفاتيح الحقول
  -- نصوصًا بلا تسميات، فتُترجم بخريطة التسميات أعلاه.
  for v_section in
    select * from jsonb_array_elements(coalesce(v_src.schema_definition -> 'sections', '[]'::jsonb))
  loop
    v_order := v_order + 10;
    insert into exam_template_sections (organization_id, template_id, key, name_ar,
                                        sort_order, section_type)
    values (p_organization_id, v_new,
            coalesce(v_section ->> 'key', 'section_' || v_order),
            coalesce(v_section ->> 'label_ar', v_section ->> 'key', 'قسم'),
            v_order,
            case when coalesce(v_section ->> 'type', 'group') in ('group','text','textarea','diagnosis')
                 then coalesce(v_section ->> 'type', 'group') else 'group' end)
    returning id into v_sec_id;

    v_forder := 0;
    if jsonb_typeof(v_section -> 'fields') = 'array' then
      for v_field in
        select case when jsonb_typeof(e) = 'string' then e #>> '{}' else e ->> 'key' end
          from jsonb_array_elements(v_section -> 'fields') e
      loop
        continue when v_field is null;
        v_forder := v_forder + 10;
        insert into exam_template_fields (organization_id, template_id, section_id, key,
                                          label_ar, field_type, sort_order, is_active)
        values (p_organization_id, v_new, v_sec_id, v_field,
                app_legacy_exam_field_label(v_field), 'text', v_forder, true);
      end loop;
    end if;
  end loop;

  perform app_rebuild_exam_schema(v_new);

  insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                         entity_title, details)
  values (p_organization_id, auth.uid(), 'medical_records', 'add', v_new,
          'نسخ نموذج فحص للتخصيص', v_src.name_ar);

  return v_new;
end $$;

revoke execute on function app_clone_exam_template(uuid, uuid, text) from public, anon;
grant execute on function app_clone_exam_template(uuid, uuid, text) to authenticated;

-- دالّة البناء: تُخرِج الشكل الموحَّد — نوع القسم من عموده، وحقول المجموعة
-- كائنات كاملة (مفتاح وتسمية ونوع ووحدة وخيارات وشرط ظهور). والواجهة تقرأ
-- الكائن والنصّ معًا، فالقالب الذي لم يُرحَّل يبقى عاملًا.
create or replace function app_rebuild_exam_schema(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schema jsonb;
  v_count  int;
begin
  select count(*) into v_count from exam_template_sections where template_id = p_template_id;

  -- لا أقسام = لا إعادة بناء. بدون هذا الشرط كان حذف آخر قسم — أو أوّل إضافة
  -- على قالب لم يُرحَّل — يستبدل تعريف القالب كلّه بقائمة فارغة.
  if v_count = 0 then
    return (select schema_definition from clinic_exam_templates where id = p_template_id);
  end if;

  select jsonb_build_object(
           'version', (select version from clinic_exam_templates where id = p_template_id),
           'sections', coalesce(jsonb_agg(sec order by sec_order), '[]'::jsonb))
    into v_schema
    from (
      select s.sort_order as sec_order,
             jsonb_strip_nulls(jsonb_build_object(
               'key', s.key,
               'label_ar', s.name_ar,
               'type', s.section_type,
               'fields', case when s.section_type <> 'group' then null else coalesce(
                 (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                            'key', f.key,
                            'label_ar', f.label_ar,
                            'type', f.field_type,
                            'unit', f.unit,
                            'required', f.is_required,
                            'options', (select jsonb_agg(jsonb_build_object('value', o.value, 'label_ar', o.label_ar)
                                                         order by o.sort_order)
                                          from exam_field_options o
                                         where o.field_id = f.id and o.is_active),
                            'visible_when', case when f.visible_when_field_id is null then null
                              else jsonb_build_object(
                                'field', (select k.key from exam_template_fields k where k.id = f.visible_when_field_id),
                                'value', f.visible_when_value) end))
                          order by f.sort_order)
                    from exam_template_fields f
                   where f.section_id = s.id and f.is_active),
                 '[]'::jsonb) end
             )) as sec
        from exam_template_sections s
       where s.template_id = p_template_id
    ) z;

  update clinic_exam_templates
     set schema_definition = coalesce(v_schema, jsonb_build_object('sections', '[]'::jsonb)),
         updated_at = now()
   where id = p_template_id;

  return v_schema;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) الإجازة المعتمدة تصل الحضور
--
--    كان اعتماد الإجازة يغيّر حالة الطلب ولا شيء غير ذلك: أيام الإجازة تبقى
--    في سجلّ الحضور «لم يسجّل»، ثم تُحوَّل غيابًا فتُخصم من الراتب. الموظّف
--    في إجازة معتمدة يُخصم عليه غيابه.
--
--    تُنشأ صفوف الحضور بحالة «في إجازة» لأيام الإجازة، ولا يُمسّ يوم سُجِّل
--    فيه حضور فعليّ. وإن كانت للموظّف مناوبة مُسندة تُحترم أيام عملها.
-- ════════════════════════════════════════════════════════════════════════

create or replace function app_mark_leave_attendance(p_request_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req    leave_requests%rowtype;
  v_day    date;
  v_days   smallint[];
  v_added  int := 0;
begin
  select * into v_req from leave_requests where id = p_request_id;
  if v_req.id is null or v_req.status <> 'approved' then
    return 0;
  end if;

  select a.weekdays into v_days
    from employee_shift_assignments a
   where a.employee_id = v_req.employee_id
     and a.organization_id = v_req.organization_id
     and (a.effective_from is null or a.effective_from <= v_req.end_date)
     and (a.effective_to is null or a.effective_to >= v_req.start_date)
   order by a.effective_from desc nulls last, a.created_at desc
   limit 1;

  v_day := v_req.start_date;
  while v_day <= v_req.end_date loop
    if v_days is null or extract(dow from v_day)::smallint = any (v_days) then
      insert into attendance_records (organization_id, employee_id, work_date, status, note)
      values (v_req.organization_id, v_req.employee_id, v_day, 'on_leave',
              'إجازة معتمدة')
      on conflict (employee_id, work_date) do nothing;
      if found then
        v_added := v_added + 1;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;

  return v_added;
end $$;

do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'app_approve_leave_request';
  v_src := replace(v_src, chr(13), '');
  if position('app_mark_leave_attendance' in v_src) > 0 then
    return; -- مُصلَح سلفًا
  end if;
  if position('insert into audit_log' in v_src) = 0 then
    raise exception 'تعذّر وصل الإجازة بالحضور: تغيّر نصّ app_approve_leave_request';
  end if;
  v_src := replace(
    v_src,
    'insert into audit_log',
    '-- أيام الإجازة تُثبَّت في سجلّ الحضور فور الاعتماد، وإلّا حُسبت غيابًا.' || chr(10) ||
    '  perform app_mark_leave_attendance(p_request_id);' || chr(10) || chr(10) ||
    '  insert into audit_log'
  );
  execute format(
    'create or replace function app_approve_leave_request(p_request_id uuid, p_conflict_note text default null) returns void language plpgsql security definer set search_path = public, pg_temp as %L',
    v_src
  );
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) صرف الراتب الفرديّ: بالصافي، ومرّة واحدة
--
--    كانت الشاشة تكتب سند صرف مباشرةً بـ«الراتب الإجمالي» المعروض في قائمة
--    الموظفين: بلا استقطاعات (غياب، تأخير، أقساط سلف)، وبلا أي فحص أن الشهر
--    صُرف سلفًا — فيمكن صرف راتب الشهر نفسه مرّتين، وبمبلغ أعلى من المستحقّ.
--
--    الصرف الفرديّ صار على **بند المسيّر المعتمَد**: مبلغه هو الصافي المحسوب،
--    ويُختم البند بسنده فلا يُصرف ثانيةً.
-- ════════════════════════════════════════════════════════════════════════

alter table payroll_run_items add column if not exists paid_voucher_id uuid;
alter table payroll_run_items add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'payroll_run_items'::regclass
       and conname = 'payroll_run_items_paid_voucher_fk'
  ) then
    alter table payroll_run_items
      add constraint payroll_run_items_paid_voucher_fk
      foreign key (paid_voucher_id) references financial_vouchers(id) on delete set null;
  end if;
end $$;

-- حارس المسيّر المعتمَد يمنع أي تعديل على بنوده — وهو الصواب للمبالغ، لكنه
-- كان يمنع كذلك ختم البند بأنه صُرف. يُستثنى عمودا الصرف وحدهما: المبالغ تبقى
-- محميّة كما كانت.
create or replace function app_guard_approved_payroll()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  if TG_TABLE_NAME = 'payroll_runs' then
    if TG_OP = 'DELETE' then
      if old.status in ('approved','paid') then
        raise exception 'المسير المعتمَد لا يُحذف — استخدم الإلغاء المنظَّم';
      end if;
      return old;
    end if;
    -- يُسمح بانتقال الحالة نفسها وبالإلغاء، لا بتعديل المبالغ
    if old.status in ('approved','paid')
       and (new.total_net is distinct from old.total_net
         or new.total_gross is distinct from old.total_gross) then
      raise exception 'مبالغ المسير المعتمَد لا تُعدَّل — ألغِه ثم أعد احتسابه';
    end if;
    return new;
  end if;

  select status into v_status from payroll_runs
   where id = coalesce(new.payroll_run_id, old.payroll_run_id);
  if v_status in ('approved','paid') then
    -- ختم الصرف وحده مسموح على البند المعتمَد: هو أثرُ عملية الصرف لا تعديلٌ
    -- في استحقاقها.
    if TG_OP = 'UPDATE'
       and (new.paid_voucher_id is distinct from old.paid_voucher_id
            or new.paid_at is distinct from old.paid_at)
       and to_jsonb(new) - 'paid_voucher_id' - 'paid_at'
           = to_jsonb(old) - 'paid_voucher_id' - 'paid_at' then
      return new;
    end if;
    raise exception 'بنود المسير المعتمَد لا تُعدَّل ولا تُحذف';
  end if;
  return coalesce(new, old);
end $$;

create or replace function app_pay_payroll_item(
  p_item_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item    payroll_run_items%rowtype;
  v_run     payroll_runs%rowtype;
  v_emp     employees%rowtype;
  v_voucher uuid;
begin
  select * into v_item from payroll_run_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'بند المسيّر غير موجود';
  end if;
  select * into v_run from payroll_runs where id = v_item.payroll_run_id;
  if not app_has_permission(v_run.organization_id, 'hr.payroll.pay') then
    raise exception 'صلاحيتك لا تسمح بصرف الرواتب (hr.payroll.pay)';
  end if;
  if v_run.status not in ('approved', 'paid') then
    raise exception 'لا يُصرف بندٌ في مسيّر حالته % — يلزم اعتماد المسيّر أوّلًا', v_run.status;
  end if;
  if v_item.paid_voucher_id is not null then
    raise exception 'هذا الراتب مصروف سلفًا بسندٍ قائم';
  end if;
  if coalesce(v_item.net_salary, 0) <= 0 then
    raise exception 'الصافي المستحقّ صفر أو أقلّ — راجع المسيّر';
  end if;

  select * into v_emp from employees where id = v_item.employee_id;

  insert into financial_vouchers (organization_id, branch_id, voucher_type, amount,
                                  employee_ref_id, employee_name, voucher_date,
                                  description, created_by)
  values (v_run.organization_id, v_run.branch_id, 'salary', v_item.net_salary,
          v_item.employee_id, v_emp.name_ar, current_date,
          coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                   format('صرف راتب %s — %s', to_char(v_run.period_month, 'YYYY-MM'), v_emp.name_ar)),
          auth.uid())
  returning id into v_voucher;

  update payroll_run_items
     set paid_voucher_id = v_voucher, paid_at = now()
   where id = p_item_id;

  insert into audit_log (organization_id, branch_id, user_id, module, action_type,
                         entity_id, entity_title, details)
  values (v_run.organization_id, v_run.branch_id, auth.uid(), 'hr', 'update', p_item_id,
          'صرف راتب فرديّ', format('%s — %s', v_emp.name_ar, v_item.net_salary));

  return v_voucher;
end $$;

revoke execute on function app_pay_payroll_item(uuid, text) from public, anon;
grant execute on function app_pay_payroll_item(uuid, text) to authenticated;

-- منظور الصرف الفرديّ: بنود المسيّرات المعتمدة وحالة صرف كلٍّ منها.
create or replace view v_payroll_items_payable as
select
  pri.id as item_id,
  pri.organization_id,
  r.id as payroll_run_id,
  r.period_month,
  r.status as run_status,
  pri.employee_id,
  e.name_ar as employee_name,
  e.job_number,
  pri.gross_salary,
  pri.deductions_total,
  pri.net_salary,
  pri.paid_voucher_id is not null as is_paid,
  pri.paid_at
from payroll_run_items pri
join payroll_runs r on r.id = pri.payroll_run_id
join employees e on e.id = pri.employee_id
where r.status in ('approved', 'paid');
alter view v_payroll_items_payable set (security_invoker = on);

-- ════════════════════════════════════════════════════════════════════════
-- 4) الدواء المصروف يصل الفوترة
--
--    ثغرتان: الوصفة غير المرتبطة بزيارة (مريض جاء إلى الصيدلية مباشرةً) لا
--    تظهر في أي قائمة فوترة أبدًا، والكمّية المعروضة للفوترة هي **الموصوفة**
--    لا **المصروفة** — فمن صُرف له نصف الكمّية يُفوتَر على كلّها.
--
--    منظور واحد يعرض ما صُرف ولم يُفوتَر، بالكمّية المصروفة وسعرها، سواء أكان
--    للوصفة زيارة أم لا. والفوترة تبقى بيد المحاسب عبر دالّة الفاتورة نفسها.
-- ════════════════════════════════════════════════════════════════════════

create or replace view v_unbilled_dispensed_prescriptions as
select
  pr.id as prescription_id,
  pr.organization_id,
  pr.branch_id,
  pr.patient_id,
  p.name_ar as patient_name,
  p.file_number,
  pr.visit_id,
  pr.doctor_id,
  d.name_ar as doctor_name,
  pr.dispensed_at,
  di.prescription_item_id,
  di.drug_item_id as item_id,
  coalesce(i.name_ar, 'دواء') as item_name,
  sum(di.quantity_dispensed)::numeric as qty,
  coalesce(max(di.unit_price), max(i.price), 0) as unit_price,
  coalesce(bool_or(i.is_vat_exempt), false) as is_vat_exempt
from prescriptions pr
join dispensing_records dr on dr.prescription_id = pr.id
join dispensing_items di on di.dispensing_record_id = dr.id
join patients p on p.id = pr.patient_id
left join doctors d on d.id = pr.doctor_id
left join items i on i.id = di.drug_item_id
where pr.is_billed = false
  and pr.status <> 'cancelled'
  and dr.status <> 'cancelled'
  and dr.sales_invoice_id is null
group by pr.id, pr.organization_id, pr.branch_id, pr.patient_id, p.name_ar, p.file_number,
         pr.visit_id, pr.doctor_id, d.name_ar, pr.dispensed_at, di.prescription_item_id,
         di.drug_item_id, i.name_ar;
alter view v_unbilled_dispensed_prescriptions set (security_invoker = on);

-- وفي قائمة فوترة الزيارة: الكمّية المصروفة تُقدَّم على الموصوفة متى وُجدت.
do $$
declare
  v_src text;
begin
  select pg_get_viewdef('v_visit_orders_unbilled'::regclass, true) into v_src;
  v_src := replace(v_src, chr(13), '');
  if position('quantity_dispensed' in v_src) > 0 then
    return; -- مُصلَح سلفًا
  end if;
  if position('pi.quantity_prescribed::numeric AS qty' in v_src) = 0 then
    raise exception 'تعذّر تصحيح كمّية الدواء في v_visit_orders_unbilled: تغيّر نصّ المنظور';
  end if;
  v_src := replace(
    v_src,
    'pi.quantity_prescribed::numeric AS qty',
    'coalesce((select sum(di.quantity_dispensed) from dispensing_items di
                where di.prescription_item_id = pi.id),
              pi.quantity_prescribed)::numeric AS qty'
  );
  execute 'create or replace view v_visit_orders_unbilled as ' || v_src;
  execute 'alter view v_visit_orders_unbilled set (security_invoker = on)';
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- الفحص الذاتي
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  v_int int;
  v_src text;
begin
  select count(*) into v_int from information_schema.columns
   where table_name = 'exam_template_sections' and column_name = 'section_type';
  if v_int = 0 then raise exception 'نوع القسم لم يُضَف'; end if;

  if not exists (select 1 from pg_proc where proname = 'app_clone_exam_template') then
    raise exception 'دالّة نسخ النموذج للتخصيص غير موجودة';
  end if;

  select prosrc into v_src from pg_proc where proname = 'app_rebuild_exam_schema';
  if position('section_type' in v_src) = 0 then
    raise exception 'دالّة بناء النموذج لا تحترم نوع القسم';
  end if;

  select prosrc into v_src from pg_proc where proname = 'app_approve_leave_request';
  if position('app_mark_leave_attendance' in v_src) = 0 then
    raise exception 'اعتماد الإجازة لا يصل الحضور';
  end if;

  select count(*) into v_int from information_schema.columns
   where table_name = 'payroll_run_items' and column_name = 'paid_voucher_id';
  if v_int = 0 then raise exception 'بند المسيّر بلا ختم صرف'; end if;

  if to_regclass('public.v_unbilled_dispensed_prescriptions') is null then
    raise exception 'منظور الأدوية المصروفة غير المفوترة غير موجود';
  end if;
end $$;

commit;
