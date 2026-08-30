-- ===========================================================================
-- المهمة 2 — الإصلاح الذاتي ثم الاعتماد.  (يحل محل TASK2_B)
--
-- لماذا نسخة جديدة: النسخة الأولى كانت تنتظر أن أرى بياناتك ثم أختار لك
-- الخيار يدويًا. وبعد أن كشفت البوابة **مخالفتين** لا واحدة، صار ذلك دورة
-- ذهاب وإياب لا داعي لها. هذه النسخة تفحص كل صف مخالف وتُصلح **الحالات
-- التي يثبت فيها الصواب وحده**، وتتوقف تمامًا عند أي حالة تحتمل أكثر من
-- تفسير — فتخبرك بها بالاسم بدل أن تخمّن.
--
-- الملف كله معاملة واحدة: إمّا الإصلاح والاعتماد معًا، أو لا شيء.
-- ولا حذف لأي صف.
--
-- شغّله في: Supabase → SQL Editor → New query → Run
-- ===========================================================================

begin;

do $$
declare
  r            record;
  v_target_org uuid;
  v_new_id     uuid;
  v_matches    integer;
  v_kids       integer;
  v_fixed      integer := 0;
begin
  for r in
    select a.id, a.organization_id as org_appt, a.patient_id, a.doctor_id, a.clinic_id,
           p.organization_id as org_pat,
           d.organization_id as org_doc,
           c.organization_id as org_cli,
           p.name_ar         as pat_name,
           p.mobile_number   as pat_mobile,
           d.name_ar         as doc_name
      from appointments a
      left join patients p on p.id = a.patient_id
      left join doctors  d on d.id = a.doctor_id
      left join clinics  c on c.id = a.clinic_id
     where p.organization_id is distinct from a.organization_id
        or d.organization_id is distinct from a.organization_id
        or (a.clinic_id is not null and c.organization_id is distinct from a.organization_id)
     order by a.created_at
  loop
    -- الأبناء أولًا: نقل موعد له زيارة أو فاتورة ينقل معه سجلًا سريريًا أو
    -- ماليًا بين منشأتين، وذلك قرار لا تتخذه هجرة. يُرفض ويُبلَّغ عنه.
    select (select count(*) from patient_visits v where v.appointment_id = r.id)
         + (select count(*) from sales_invoices s where s.appointment_id = r.id)
      into v_kids;

    -- ── الحالة (1): المريض والطبيب (والعيادة إن وُجدت) كلهم في منشأة واحدة
    --    أخرى ⇒ الموعد نفسه هو المُسجَّل تحت منشأة خاطئة. آمن ومحدَّد.
    if r.org_pat is not null
       and r.org_doc is not null
       and r.org_pat = r.org_doc
       and r.org_pat is distinct from r.org_appt
       and (r.clinic_id is null or r.org_cli = r.org_pat)
    then
      if v_kids > 0 then
        raise exception
          'الموعد % مريضه وطبيبه في منشأة أخرى، لكن له % سجلًا مرتبطًا (زيارة/فاتورة). نقل الموعد ينقل سجلًا ماليًا أو سريريًا بين منشأتين — أوقفتُ العملية ليكون القرار قرارك.',
          r.id, v_kids;
      end if;
      update appointments set organization_id = r.org_pat where id = r.id;
      v_fixed := v_fixed + 1;
      raise notice 'الموعد %: نُقل إلى منشأة المريض والطبيب (الخطأ كان في organization_id)', r.id;
      continue;
    end if;

    -- ── الحالة (2): المريض وحده مخالف ⇒ يُعاد ربطه بنظيره في منشأة الموعد.
    --    المطابقة بالاسم + الجوال، وتُقبل فقط إن أعطت **نظيرًا واحدًا**.
    if r.org_pat is distinct from r.org_appt
       and (r.org_doc is null or r.org_doc = r.org_appt)
    then
      -- ملاحظة: `min(uuid)` غير موجود في PostgreSQL — التجميع في مصفوفة ثم
      -- قراءة طولها هو الطريق الصحيح، ويعطي العدد والمعرّف في تمريرة واحدة.
      select coalesce(array_length(arr,1),0), case when array_length(arr,1)=1 then arr[1] end
        into v_matches, v_new_id
        from (select array_agg(p2.id) as arr
                from patients p2
               where p2.organization_id = r.org_appt
                 and p2.name_ar = r.pat_name
                 and p2.mobile_number is not distinct from r.pat_mobile) z;

      if v_matches = 1 then
        update appointments set patient_id = v_new_id where id = r.id;
        v_fixed := v_fixed + 1;
        raise notice 'الموعد %: أُعيد ربطه بالمريض المقابل (%) في منشأة الموعد', r.id, v_new_id;
        continue;
      end if;
      raise exception
        'الموعد %: المريض «%» من منشأة أخرى، ووجدتُ % نظيرًا مطابقًا في منشأة الموعد (المطلوب واحد بالضبط). صفر يعني أن المريض غير مُنشأ هناك؛ أكثر من واحد يعني تشابه أسماء. أوقفتُ العملية.',
        r.id, r.pat_name, v_matches;
    end if;

    -- ── الحالة (3): الطبيب وحده مخالف ⇒ نفس منطق الحالة (2).
    if r.org_doc is distinct from r.org_appt
       and (r.org_pat is null or r.org_pat = r.org_appt)
    then
      select coalesce(array_length(arr,1),0), case when array_length(arr,1)=1 then arr[1] end
        into v_matches, v_new_id
        from (select array_agg(d2.id) as arr
                from doctors d2
               where d2.organization_id = r.org_appt
                 and d2.name_ar = r.doc_name) z;

      if v_matches = 1 then
        update appointments set doctor_id = v_new_id where id = r.id;
        v_fixed := v_fixed + 1;
        raise notice 'الموعد %: أُعيد ربطه بالطبيب المقابل (%) في منشأة الموعد', r.id, v_new_id;
        continue;
      end if;
      raise exception
        'الموعد %: الطبيب «%» من منشأة أخرى، ووجدتُ % نظيرًا مطابقًا في منشأة الموعد (المطلوب واحد بالضبط). أوقفتُ العملية.',
        r.id, r.doc_name, v_matches;
    end if;

    -- ── ما عدا ذلك: تعارض لا يُحسم آليًا (كأن يكون المريض في منشأة والطبيب
    --    في ثالثة). لا تخمين.
    raise exception
      'الموعد %: أطرافه موزَّعة على منشآت مختلفة (الموعد=% المريض=% الطبيب=% العيادة=%). لا إصلاح واحد صحيح — يلزم قرارك.',
      r.id, r.org_appt, r.org_pat, r.org_doc, r.org_cli;
  end loop;

  raise notice 'عدد المواعيد المُصلَحة: %', v_fixed;
end $$;

-- ---------------------------------------------------------------------------
-- بوابة الأمان: لا يُعتمد قيد واحد ما بقيت مخالفة
-- ---------------------------------------------------------------------------
do $$
declare v_total integer; v_detail text;
begin
  select coalesce(sum(n),0), string_agg(rel || ' = ' || n, ' | ' order by rel)
    into v_total, v_detail
  from (
    select 'appointments→patients' rel, count(*) n from appointments a join patients p on p.id=a.patient_id where p.organization_id<>a.organization_id
    union all select 'appointments→doctors', count(*) from appointments a join doctors d on d.id=a.doctor_id where d.organization_id<>a.organization_id
    union all select 'appointments→clinics', count(*) from appointments a join clinics c on c.id=a.clinic_id where c.organization_id<>a.organization_id
    union all select 'waitlist→patients', count(*) from appointment_waitlist w join patients p on p.id=w.patient_id where p.organization_id<>w.organization_id
    union all select 'waitlist→doctors', count(*) from appointment_waitlist w join doctors d on d.id=w.doctor_id where d.organization_id<>w.organization_id
    union all select 'visits→patients', count(*) from patient_visits v join patients p on p.id=v.patient_id where p.organization_id<>v.organization_id
    union all select 'visits→doctors', count(*) from patient_visits v join doctors d on d.id=v.doctor_id where d.organization_id<>v.organization_id
    union all select 'visits→clinics', count(*) from patient_visits v join clinics c on c.id=v.clinic_id where c.organization_id<>v.organization_id
    union all select 'visits→appointments', count(*) from patient_visits v join appointments a on a.id=v.appointment_id where a.organization_id<>v.organization_id
    union all select 'invoices→patients', count(*) from sales_invoices s join patients p on p.id=s.patient_id where p.organization_id<>s.organization_id
    union all select 'invoices→doctors', count(*) from sales_invoices s join doctors d on d.id=s.doctor_id where d.organization_id<>s.organization_id
    union all select 'invoices→clinics', count(*) from sales_invoices s join clinics c on c.id=s.clinic_id where c.organization_id<>s.organization_id
    union all select 'invoices→appointments', count(*) from sales_invoices s join appointments a on a.id=s.appointment_id where a.organization_id<>s.organization_id
  ) t;

  if v_total > 0 then
    raise exception 'ما زالت هناك % مخالفة — لم يُعتمد أي قيد. التفصيل: %', v_total, v_detail;
  end if;
  raise notice 'cross_tenant_patient_links = 0 ✅';
end $$;

-- ---------------------------------------------------------------------------
-- اعتماد القيود الثلاثة عشر
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- اعتماد قيود العزل
--
-- حلقة على `pg_constraint` لا قائمة مكتوبة بالأسماء: القائمة الثابتة تنهار
-- كليًا إن كان قيد واحد غير موجود (هجرة طُبِّقت جزئيًا، أو قيد أُسقط يدويًا)
-- فتضيع الأربعة عشر بسبب واحد. والحلقة تعتمد الموجود غير المعتمد فقط،
-- وتشمل تلقائيًا أي قيد `%_tenant_fk` يُضاف لاحقًا (مثل قيد الزيارة في 0052).
-- ---------------------------------------------------------------------------
do $$
declare c record; v_n integer := 0;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
      from pg_constraint
     where contype = 'f' and conname like '%tenant_fk' and not convalidated
     order by 1, 2
  loop
    execute format('alter table %s validate constraint %I', c.tbl, c.conname);
    v_n := v_n + 1;
    raise notice 'اعتُمد: %.%', c.tbl, c.conname;
  end loop;
  raise notice 'عدد القيود المعتمَدة في هذا التشغيل: %', v_n;
end $$;

select count(*) filter (where not convalidated) as غير_معتمد,
       count(*)                                 as إجمالي_قيود_العزل
from pg_constraint where contype = 'f' and conname like '%tenant_fk';

commit;
