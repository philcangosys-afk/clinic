-- ---------------------------------------------------------------------------
-- 0165_dental_lab_enable.sql — معمل الأسنان: تفعيله، وصلاحياته، ودليل الألوان
-- ---------------------------------------------------------------------------
-- شاشة معامل الأسنان مبنيّة منذ مدّة (`client/pages/DentalLab.tsx` — الطلبيات
-- وأصناف المعامل والأرصدة)، وجداولها في القاعدة (`dental_lab_orders`،
-- `dental_lab_order_items`، `dental_lab_items`، `dental_lab_balances`)،
-- **ولا تظهر لأحد**. السبب ليس في الشاشة:
--
--   • `module-registry` يشترط الميزة `dental_lab` والصلاحية
--     `dental_lab.view`.
--   • و**أيٌّ منهما غير موجود في القاعدة**: لا صفّ في `feature_catalog`، ولا
--     صفّ في `permission_catalog`، ولا صفّ في `organization_features`.
--
-- فالشرط لا يتحقّق أبدًا، والوحدة تُرشَّح من القائمة الجانبية صامتةً. شاشةٌ
-- كاملة وجداولها مبنيّة ولا سبيل إليها — لأنّ ثلاثة صفوف لم تُدرَج.
--
-- وتُضاف هنا كذلك **أدلّة ألوان الأسنان**: `tooth_shade_guides` و
-- `tooth_shades` يقرؤهما `DentalLab.tsx` في اختيار لون الطلبية، ولا مسار
-- كتابةٍ لهما ولا بذرة — فالقائمة فارغة أبدًا، ويُرسَل التركيب بلا لون.
-- (`docs/AUDIT-COMPLETENESS.md` يرصدهما منذ مدّة تحت «تُقرأ ولا مسار كتابة
-- لها».)
--
-- **هذه بيانات مرجعية عالمية لا بيانات منشأة:** VITA Classical و
-- VITA 3D-MASTER معياران يستعملهما كل معمل أسنان في العالم بالأسماء نفسها،
-- فهما كـ`icd10_codes` تمامًا — تُزرع بالترقية. أمّا أسعار الأصناف وأسماء
-- المعامل فبياناتُ منشأةٍ بعينها ولا تُزرع هنا.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الميزة
-- ═══════════════════════════════════════════════════════════════════════════
insert into feature_catalog (feature_key, name_ar, name_en, category_key, is_core, display_order)
select 'dental_lab', 'معامل الأسنان', 'Dental Lab', 'التشغيل والإدارة', false, 335
where not exists (select 1 from feature_catalog where feature_key = 'dental_lab');

insert into organization_features (organization_id, feature_key, enabled)
select o.id, 'dental_lab', true from organizations o
on conflict (organization_id, feature_key) do nothing;

-- المنشأة التي أُنشئت قبل هذه الترقية وسُجِّلت لها الميزة معطَّلة تُفعَّل:
-- الصفّ الموجود بـ`enabled = false` يُبقي الشاشة محجوبة رغم كل ما سبق.
update organization_features set enabled = true
 where feature_key = 'dental_lab' and enabled is distinct from true;

-- المنشآت الجديدة: تُدرَج الميزة في دالّة التهيئة كما فعلت 0105 لمساحة عمل
-- الطبيب. الترقيع نصّيّ لأنّ الدالّة تُعاد كتابتها في ترقياتٍ كثيرة، ونسخُها
-- كاملةً هنا يُجمّدها على صورتها اليوم.
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_after_organization_created';
  if v_src is null then
    raise notice 'app_after_organization_created غير موجودة — تُخطّى';
    return;
  end if;
  -- تطبيع نهايات الأسطر: نصّ الدالّة المخزَّن قد يحمل \r إن نُفِّذت ترقيةٌ
  -- سابقة من ملفّ بنهايات ويندوز، فلا تطابق أنماط البحث المكتوبة بـ\n.
  v_src := replace(v_src, chr(13), '');
  if position('''dental_lab''' in v_src) > 0 then
    return; -- مُدرَجة سلفًا
  end if;
  v_new := replace(v_src, '''audit_log'',''settings''',
                          '''audit_log'',''settings'',''dental_lab''');
  if v_new = v_src then
    raise exception 'تعذّر إدراج ميزة معمل الأسنان في دالّة تهيئة المنشأة';
  end if;
  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) الصلاحيات
--
-- فصلٌ بين النظر والتصرّف: من يفتح الشاشة ليرى أين وصلت طلبية مريضه ليس
-- بالضرورة من يعتمد طلبيةً على حساب المنشأة عند المعمل.
-- ═══════════════════════════════════════════════════════════════════════════
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
select v.k, v.n, 'dental_lab', v.d, v.o
from (values
  ('dental_lab.view',   'عرض معامل الأسنان', 'فتح شاشة الطلبيات والأصناف والأرصدة', 3350),
  ('dental_lab.manage', 'إدارة معامل الأسنان', 'إنشاء الطلبيات وتعديلها وإدارة أصناف المعامل', 3351)
) as v(k, n, d, o)
where not exists (select 1 from permission_catalog c where c.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  -- الطبيب يرسل التركيب ويتابعه: هو صاحب الطلبية
  ('doctor',           'dental_lab.view'), ('doctor', 'dental_lab.manage'),
  ('branch_manager',   'dental_lab.view'), ('branch_manager', 'dental_lab.manage'),
  -- المحاسب يرى الأرصدة ولا يُنشئ طلبيات
  ('accountant',       'dental_lab.view'),
  -- الاستقبال يرى ليُجيب المريض «متى يجهز؟» ولا يتصرّف
  ('receptionist',     'dental_lab.view'),
  ('nurse',            'dental_lab.view')
) as v(r, p)
where not exists (
  select 1 from role_default_permissions d
   where d.role_key = v.r and d.permission_key = v.p
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) أدلّة ألوان الأسنان — بيانات مرجعية عالمية
--
-- **لماذا لا تُترك للمستخدم:** لون التركيبة يُرسَل إلى المعمل برمزٍ معياريّ
-- (A2، 2M2) لا بوصفٍ حرّ. ومنشأةٌ تكتبه يدويًّا تُنتج «A2» و«a2» و«أ٢» في
-- ثلاث طلبيات، فلا يُفرز ولا يُقارن ولا يُعاد طلبه بثقة.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  org         record;
  v_classical uuid;
  v_3d        uuid;
begin
  -- الأدلّة مقيَّدة بالمنشأة (`tooth_shade_guides.organization_id`)، فتُزرع
  -- لكلٍّ على حدة. ولا يُزرع دليلٌ عالميّ واحد: منشأةٌ قد تحذف لونًا لا
  -- تستعمله، فيختفي من المنشأة الأخرى معه.
  for org in select id from organizations loop

    -- ── VITA Classical — ستّة عشر لونًا بترتيبها المعياريّ ──────────────
    select id into v_classical from tooth_shade_guides
     where organization_id = org.id and name = 'VITA Classical' limit 1;
    if v_classical is null then
      insert into tooth_shade_guides (organization_id, name)
      values (org.id, 'VITA Classical')
      returning id into v_classical;
    end if;

    insert into tooth_shades (shade_guide_id, code, sort_order)
    select v_classical, v.c, v.o from (values
      ('A1',1),('A2',2),('A3',3),('A3.5',4),('A4',5),
      ('B1',6),('B2',7),('B3',8),('B4',9),
      ('C1',10),('C2',11),('C3',12),('C4',13),
      ('D2',14),('D3',15),('D4',16)
    ) as v(c, o)
    where not exists (
      select 1 from tooth_shades s
       where s.shade_guide_id = v_classical and s.code = v.c
    );

    -- ── VITA 3D-MASTER — السطوع ثم الإشباع ثم الميل اللونيّ ─────────────
    select id into v_3d from tooth_shade_guides
     where organization_id = org.id and name = 'VITA 3D-MASTER' limit 1;
    if v_3d is null then
      insert into tooth_shade_guides (organization_id, name)
      values (org.id, 'VITA 3D-MASTER')
      returning id into v_3d;
    end if;

    insert into tooth_shades (shade_guide_id, code, sort_order)
    select v_3d, v.c, v.o from (values
      ('0M1',1),('0M2',2),('0M3',3),
      ('1M1',4),('1M2',5),
      ('2L1.5',6),('2L2.5',7),('2M1',8),('2M2',9),('2M3',10),('2R1.5',11),('2R2.5',12),
      ('3L1.5',13),('3L2.5',14),('3M1',15),('3M2',16),('3M3',17),('3R1.5',18),('3R2.5',19),
      ('4L1.5',20),('4L2.5',21),('4M1',22),('4M2',23),('4M3',24),('4R1.5',25),('4R2.5',26),
      ('5M1',27),('5M2',28),('5M3',29)
    ) as v(c, o)
    where not exists (
      select 1 from tooth_shades s
       where s.shade_guide_id = v_3d and s.code = v.c
    );

  end loop;
end $$;

-- **المنشأة التي تُنشأ بعد هذه الترقية لا تُزرع لها الأدلّة تلقائيًّا.**
-- إعادة تنفيذ هذه الترقية تزرعها لكل منشأةٍ ناقصة بلا أثرٍ على القائمة —
-- وهذا مذكورٌ هنا لا مسكوتٌ عنه.

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0165_dental_lab_enable.sql
-- ---------------------------------------------------------------------------
