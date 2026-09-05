-- ============================================================================
-- 0140 — التخصصات الفرعية، وأنواع العيادات، وربط الخدمة بتخصصها
-- ============================================================================
-- المشكلة التي تُحلّ:
--
--   عيادة الأسنان ليست تخصصًا واحدًا: فيها خلع وتقويم وتجميل وزراعة وعلاج
--   عصب. والجلدية فيها ليزر وحقن تجميل وتقشير. النظام اليوم يعرف
--   «الأسنان» و«الجلدية» كتخصصين مسطّحين، ولا يعرف ما تحتهما:
--
--     1) `lookup_values` فيه عمود `parent_value_id` منذ إنشائه، لكنه **لم
--        يُستعمل قط لبناء شجرة تخصصات**: الواحد والعشرون تخصصًا كلها صفوف
--        مسطّحة بلا أب ولا ابن.
--
--     2) `doctors.subspecialty` عمود **نصّ حرّ بلا قيد ولا لائحة**، لا رابط
--        له بتخصص الطبيب الأب. فـ«تقويم» يُكتب بأربع صور مختلفة، ولا استعلام
--        يجمعها، ولا شاشة تُصفّي بها.
--
--     3) `clinics.clinic_type` **نصّ حرّ بلا قيد** — موثَّقٌ كفجوة في تعليق
--        0080 نفسه، ولم يُملأ لأيّ عيادة (صفر صفوف).
--
--     4) فئات الخدمات (`item_categories`) فيها شجرة **مبنيّة فعلًا للأسنان**
--        (خدمات الأسنان ← تقويم، جراحة، تركيبات، علاج تحفظي…) — وهذا جيّد —
--        لكن فئات الجلدية (BOTOX، COSMETIC، DERMA) **مسطّحة بلا أب**، ولا
--        شيء يربط أيّ فئة بتخصصها، فلا يمكن أن تُصفّى خدمات عيادةٍ بتخصصها.
--
-- ما يفعله هذا الملف:
--   • يبني شجرة التخصصات الفرعية تحت التخصصات القائمة (لا يُنشئ تخصصًا
--     جديدًا: يعلّق الأبناء على الآباء الموجودين).
--   • يربط `doctors.subspecialty_value_id` بالشجرة، ويحرس أن يكون الابن
--     تحت تخصص الطبيب نفسه.
--   • يجعل `clinic_type` لائحةً مغلقة قابلة للتوسيع من شاشة البيانات
--     المرجعية — لا قيدًا جامدًا في الكود.
--   • ينظّم فئات الجلدية تحت أبٍ واحد، ويربط كل فئة بتخصصها.
--
-- **لا شيء يخصّ SMS هنا، ولا أيّ تكامل مزوّد رسائل.**
-- ============================================================================

do $zc_pre$
begin
  if to_regclass('public.lookup_values') is null
     or to_regclass('public.lookup_categories') is null then
    raise exception E'⛔ لا يمكن تنفيذ 0140: جداول اللوائح المرجعية غير موجودة.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'lookup_values' and column_name = 'parent_value_id') then
    raise exception E'⛔ لا يمكن تنفيذ 0140: `lookup_values.parent_value_id` غير موجود.';
  end if;
end
$zc_pre$;

-- ===========================================================================
-- 1) شجرة التخصصات الفرعية
-- ===========================================================================
-- تُعلَّق على التخصصات الموجودة بمفتاح `extra->>'specialty_code'` — وهو
-- المعرّف الثابت الذي زُرعت به. لا يُنشأ تخصصٌ أب جديد، ولا يُمسّ ما هو قائم.
--
-- القائمة أدناه **بداية معتادة لا حصر**: تُعدَّل وتُحذف ويُضاف إليها من شاشة
-- «البيانات المرجعية» كأيّ قيمة لائحة أخرى.
-- **اللوائح في هذا النظام عامة لا مملوكة لمنشأة**: `lookup_categories` بلا
-- `organization_id` مملوء، و`lookup_values` بلا عمود منشأة أصلًا. فالبذر يجري
-- مرّة واحدة للنظام كلّه، لا مرّة لكل منشأة. اتّباع النموذج القائم أسلم من
-- بناء نموذجٍ ثانٍ بجانبه.
create or replace function app_seed_subspecialties()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cat uuid;
  v_n   integer := 0;
  r     record;
begin
  select id into v_cat from lookup_categories
   where key = 'medical_specialties' limit 1;
  if v_cat is null then
    return 0;  -- لا لائحة تخصصات: لا شيء يُعلَّق عليه
  end if;

  for r in
    select * from (values
      -- الأسنان
      ('simple_dental', 'خلع وجراحة الفم',        'Oral Surgery',      10),
      ('simple_dental', 'تقويم الأسنان',          'Orthodontics',      20),
      ('simple_dental', 'تجميل الأسنان',          'Cosmetic Dentistry',30),
      ('simple_dental', 'زراعة الأسنان',          'Implantology',      40),
      ('simple_dental', 'علاج العصب',             'Endodontics',       50),
      ('simple_dental', 'علاج اللثة',             'Periodontics',      60),
      ('simple_dental', 'التركيبات',              'Prosthodontics',    70),
      ('simple_dental', 'أسنان الأطفال',          'Pedodontics',       80),
      -- الجلدية
      ('derma',         'الليزر',                 'Laser',             10),
      ('derma',         'الحقن التجميلي',         'Cosmetic Injection',20),
      ('derma',         'التقشير',                'Peeling',           30),
      ('derma',         'زراعة الشعر',            'Hair Transplant',   40),
      ('derma',         'الأمراض الجلدية العامة', 'General Dermatology',50),
      ('derma',         'التجميل غير الجراحي',    'Aesthetic',         60)
    ) as t(parent_code, name_ar, name_en, ord)
  loop
    insert into lookup_values (category_id, name_ar, name_en, parent_value_id, sort_order)
    select v_cat, r.name_ar, r.name_en, p.id, r.ord
      from lookup_values p
     where p.category_id = v_cat
       and p.extra->>'specialty_code' = r.parent_code
       and not exists (
             select 1 from lookup_values x
              where x.category_id = v_cat
                and x.parent_value_id = p.id
                and x.name_ar = r.name_ar);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

select app_seed_subspecialties();

-- ===========================================================================
-- 2) التخصص الفرعي للطبيب — من الشجرة لا من لوحة المفاتيح
-- ===========================================================================
alter table doctors
  add column if not exists subspecialty_value_id uuid references lookup_values(id);

comment on column doctors.subspecialty_value_id is
  'التخصص الفرعي من شجرة medical_specialties. يجب أن يكون ابنًا لتخصص الطبيب نفسه.';
comment on column doctors.subspecialty is
  'عمود قديم بنصّ حرّ. لا تكتب فيه الواجهة بعد 0140 — تُستعمل subspecialty_value_id. أُبقي لأن حذفه يُضيّع ما كُتب فيه قبل الشجرة.';

-- نقل ما يطابق اسمًا في الشجرة، وترك ما لا يطابق كما هو ليراجعه صاحبه.
update doctors d
   set subspecialty_value_id = v.id
  from lookup_values v
  join lookup_categories c on c.id = v.category_id
 where c.key = 'medical_specialties'
   and v.parent_value_id is not null
   and btrim(d.subspecialty) = v.name_ar
   and d.subspecialty_value_id is null;

-- الحارس: الابن تحت أبيه.
-- تخصصٌ فرعيّ من شجرة غير شجرة الطبيب يعني طبيب أسنان تخصصه الفرعي «الليزر
-- الجلدي» — تصنيفٌ يفسد كل تصفية تُبنى عليه لاحقًا.
create or replace function app_guard_doctor_subspecialty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent uuid;
  v_cat_key text;
begin
  if new.subspecialty_value_id is null then
    return new;
  end if;

  select v.parent_value_id, c.key into v_parent, v_cat_key
    from lookup_values v join lookup_categories c on c.id = v.category_id
   where v.id = new.subspecialty_value_id;

  if v_cat_key is null then
    raise exception 'التخصص الفرعي غير موجود في اللوائح';
  end if;
  if v_cat_key <> 'medical_specialties' then
    raise exception 'التخصص الفرعي يجب أن يكون من لائحة التخصصات الطبية';
  end if;
  if v_parent is null then
    raise exception 'هذه القيمة تخصص رئيسي لا فرعي — اختر ما تحته';
  end if;
  if new.specialty_value_id is not null and v_parent <> new.specialty_value_id then
    raise exception 'التخصص الفرعي ليس تحت تخصص الطبيب';
  end if;

  -- تخصص فرعي بلا تخصص أب على الطبيب: يُملأ الأب تلقائيًّا بدل رفض الحفظ.
  if new.specialty_value_id is null then
    new.specialty_value_id := v_parent;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_doctor_subspecialty on doctors;
create trigger trg_guard_doctor_subspecialty
  before insert or update of subspecialty_value_id, specialty_value_id on doctors
  for each row execute function app_guard_doctor_subspecialty();

create index if not exists idx_doctors_subspecialty
  on doctors (organization_id, subspecialty_value_id);

-- ===========================================================================
-- 3) نوع العيادة — لائحة مغلقة قابلة للتوسيع
-- ===========================================================================
-- `clinic_type` بقي نصًّا حرًّا منذ 0080، وهو موثَّقٌ هناك كفجوة. القيد الجامد
-- في الكود يمنع المنشأة من إضافة نوعٍ لم نتوقّعه؛ واللائحة المرجعية تحرس
-- القيمة وتترك التوسيع بيد صاحب النظام. فالعمود يبقى واحدًا، والحارس يتحقّق
-- أن قيمته موجودة في لائحة `clinic_types`.
do $$
declare v_cat uuid;
begin
  insert into lookup_categories (key, name_ar, name_en)
  select 'clinic_types', 'أنواع العيادات', 'Clinic Types'
  where not exists (select 1 from lookup_categories where key = 'clinic_types');

  select id into v_cat from lookup_categories where key = 'clinic_types' limit 1;

  insert into lookup_values (category_id, code, name_ar, name_en, sort_order)
  select v_cat, t.code, t.ar, t.en, t.ord
    from (values
      ('general',      'عيادة عامة',        'General',        10),
      ('dental',       'أسنان',             'Dental',         20),
      ('dermatology',  'جلدية وتجميل',      'Dermatology',    30),
      ('pediatrics',   'أطفال',             'Pediatrics',     40),
      ('obgyn',        'نساء وولادة',       'OB/GYN',         50),
      ('internal',     'باطنية',            'Internal',       60),
      ('orthopedic',   'عظام',              'Orthopedics',    70),
      ('ent',          'أنف وأذن وحنجرة',   'ENT',            80),
      ('ophthalmology','عيون',              'Ophthalmology',  90),
      ('physiotherapy','علاج طبيعي',        'Physiotherapy', 100),
      ('nutrition',    'تغذية',             'Nutrition',     110),
      ('psychiatry',   'نفسية',             'Psychiatry',    120),
      ('procedures',   'غرفة إجراءات',      'Procedure Room',130),
      ('emergency',    'طوارئ',             'Emergency',     140)
    ) as t(code, ar, en, ord)
   where not exists (select 1 from lookup_values x
                      where x.category_id = v_cat and x.code = t.code);
end $$;

create or replace function app_guard_clinic_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.clinic_type is null or btrim(new.clinic_type) = '' then
    new.clinic_type := null;
    return new;
  end if;

  if not exists (
        select 1 from lookup_values v
          join lookup_categories c on c.id = v.category_id
         where c.key = 'clinic_types'
           and v.code = new.clinic_type
           and not coalesce(v.is_disabled, false)) then
    raise exception 'نوع عيادة غير معروف (%) — أضِفه في البيانات المرجعية ← أنواع العيادات', new.clinic_type;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_clinic_type on clinics;
create trigger trg_guard_clinic_type
  before insert or update of clinic_type on clinics
  for each row execute function app_guard_clinic_type();

-- ===========================================================================
-- 4) فئات الخدمات: أبٌ للجلدية، وربطُ الفئة بتخصصها
-- ===========================================================================
-- شجرة الأسنان مبنيّة سلفًا في بيانات المنشأة (خدمات الأسنان ← تقويم، جراحة،
-- تركيبات…) فلا تُمسّ. الناقص أمران: فئات الجلدية معلّقة بلا أب، ولا شيء
-- يقول لأيّ تخصص تنتمي الفئة — وبدونه لا تُصفّى خدمات العيادة بتخصصها.
--
-- الربط يُكتب في `extra->>'specialty_code'` — نفس المفتاح الذي تحمله
-- التخصصات — فلا يُضاف عمود لغرضٍ يكفيه حقلٌ قائم.
do $$
declare
  v_cat   uuid;
  v_derma uuid;
begin
  select id into v_cat from lookup_categories where key = 'item_categories' limit 1;
  if v_cat is null then
    raise notice 'لا لائحة فئات أصناف — تُخطّى فئات الجلدية';
    return;
  end if;

  -- أب فئات الجلدية: يُستعمل الموجود إن وُجد، ولا يُنشأ ثانٍ بنفس المعنى.
  select id into v_derma from lookup_values
   where category_id = v_cat and name_ar = 'خدمات الجلدية' limit 1;

  if v_derma is null then
    insert into lookup_values (category_id, name_ar, name_en, sort_order)
    values (v_cat, 'خدمات الجلدية', 'Dermatology Services', 200)
    returning id into v_derma;
  end if;

  -- الفئات الجلدية القائمة تُعلَّق على أبيها بدل أن تبقى مسطّحة.
  update lookup_values
     set parent_value_id = v_derma
   where category_id = v_cat
     and parent_value_id is null
     and id <> v_derma
     and name_ar in ('BOTOX', 'COSMETIC', 'DERMA',
                     'معدات وأدوات تجميل (جلدية)');

  -- الفئات الجلدية المعتادة التي لا وجود لها بعد.
  insert into lookup_values (category_id, name_ar, name_en, parent_value_id, sort_order)
  select v_cat, t.ar, t.en, v_derma, t.ord
    from (values
      ('جلسات ليزر',      'Laser Sessions',      10),
      ('حقن تجميل',       'Cosmetic Injections', 20),
      ('فيلر',            'Fillers',             30),
      ('تقشير',           'Peeling',             40),
      ('علاج حب الشباب',  'Acne Treatment',      50),
      ('علاج التصبّغات',   'Pigmentation',        60)
    ) as t(ar, en, ord)
   where not exists (select 1 from lookup_values x
                      where x.category_id = v_cat and x.name_ar = t.ar);

  -- وسم كل فئة بتخصصها: الجذر يوسَم، والأبناء يرثون.
  update lookup_values
     set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('specialty_code', 'derma')
   where category_id = v_cat
     and (id = v_derma or parent_value_id = v_derma)
     and coalesce(extra->>'specialty_code', '') = '';

  update lookup_values
     set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('specialty_code', 'simple_dental')
   where category_id = v_cat
     and coalesce(extra->>'specialty_code', '') = ''
     and (name_ar = 'خدمات الأسنان'
          or parent_value_id in (select id from lookup_values
                                  where category_id = v_cat and name_ar = 'خدمات الأسنان'));
end $$;

-- ===========================================================================
-- 5) العروض
-- ===========================================================================
drop view if exists v_specialty_tree;
create view v_specialty_tree
with (security_invoker = on) as
select v.id,
       v.name_ar,
       v.name_en,
       v.parent_value_id,
       p.name_ar                          as parent_name_ar,
       v.extra->>'specialty_code'         as specialty_code,
       coalesce(p.extra->>'specialty_code', v.extra->>'specialty_code') as root_code,
       (v.parent_value_id is null)        as is_root,
       v.sort_order,
       coalesce(v.is_disabled, false)     as is_disabled,
       -- اللوائح عامة، فالعدّ يشمل من يراهم المستخدم فقط: RLS على `doctors`
       -- تحصر النتيجة في منشآته وحدها.
       (select count(*) from doctors d
         where d.specialty_value_id = v.id or d.subspecialty_value_id = v.id) as doctor_count
  from lookup_values v
  join lookup_categories c on c.id = v.category_id
  left join lookup_values p on p.id = v.parent_value_id
 where c.key = 'medical_specialties';

comment on view v_specialty_tree is
  'شجرة التخصصات: الجذور وأبناؤها، وعدد الأطباء تحت كل عقدة.';

drop view if exists v_service_category_tree;
create view v_service_category_tree
with (security_invoker = on) as
select v.id,
       v.name_ar,
       v.name_en,
       v.parent_value_id,
       p.name_ar                  as parent_name_ar,
       coalesce(v.extra->>'specialty_code', p.extra->>'specialty_code') as specialty_code,
       (v.parent_value_id is null) as is_root,
       v.sort_order,
       coalesce(v.is_disabled, false) as is_disabled,
       (select count(*) from items i
         where i.category_value_id = v.id
           and not coalesce(i.is_archived, false)) as item_count
  from lookup_values v
  join lookup_categories c on c.id = v.category_id
  left join lookup_values p on p.id = v.parent_value_id
 where c.key = 'item_categories';

comment on view v_service_category_tree is
  'شجرة فئات الخدمات والأصناف، وتخصص كل فئة، وعدد الأصناف الحيّة تحتها.';

-- خدمات كل تخصص: ما تعرضه شاشة العيادة حين يكون لها تخصص.
drop view if exists v_services_by_specialty;
create view v_services_by_specialty
with (security_invoker = on) as
select i.id                as item_id,
       i.organization_id,
       i.code,
       i.name_ar,
       i.price,
       i.medical_service_type,
       i.duration_minutes,
       i.category_value_id,
       v.name_ar           as category_name,
       coalesce(v.extra->>'specialty_code', p.extra->>'specialty_code') as specialty_code,
       coalesce(i.is_archived, false) as is_archived
  from items i
  join lookup_values v on v.id = i.category_value_id
  left join lookup_values p on p.id = v.parent_value_id;

comment on view v_services_by_specialty is
  'الخدمة وتخصصها المستنتَج من فئتها — لتصفية خدمات العيادة بتخصصها.';

-- ===========================================================================
-- 6) تحقّق فوريّ
-- ===========================================================================
do $zc_verify$
declare v_n int;
begin
  -- شجرة تخصصات بلا ابنٍ واحد تعني أن البذر لم يُعلَّق على أيّ أب.
  select count(*) into v_n from v_specialty_tree where not is_root;
  if v_n = 0 and exists (select 1 from lookup_values v
                          join lookup_categories c on c.id = v.category_id
                         where c.key = 'medical_specialties'
                           and v.extra->>'specialty_code' in ('simple_dental','derma')) then
    raise exception 'لم يُعلَّق أيّ تخصص فرعي رغم وجود تخصصَي الأسنان والجلدية';
  end if;

  -- حارس نوع العيادة يعمل فعلًا لا شكلًا.
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_clinic_type') then
    raise exception 'حارس نوع العيادة لم يُركَّب';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_doctor_subspecialty') then
    raise exception 'حارس التخصص الفرعي لم يُركَّب';
  end if;

  -- فئة جلدية بلا أب بعد التنظيم تعني أن الشجرة لم تُبنَ.
  select count(*) into v_n from v_service_category_tree
   where is_root and name_ar in ('BOTOX','COSMETIC','DERMA');
  if v_n > 0 then
    raise exception '% فئة جلدية ما زالت بلا أب', v_n;
  end if;
end
$zc_verify$;
