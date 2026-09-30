-- ============================================================================
-- SETUP — استبدال قائمة الخدمات كاملةً: مجمع أسناني المتميز الطبي
-- ============================================================================
--
-- ليست ترقيةً في التسلسل: بياناتُ منشأةٍ بعينها. تُنفَّذ مرّةً على قاعدة هذا
-- المجمع، وإعادةُ تنفيذها لا تُكرّر شيئًا (انظر «الإعادة» أدناه).
--
-- المصدر: ملفّ المالك «الخدمات العلاجية» — 104 خدمات في 10 أقسام.
--
-- ── ما يحدث للخدمات القديمة ──────────────────────────────────────────────
--
-- «امسح كلّ الخدمات» بابان، كما في الموظّفين (0188) وشركات التأمين (0190):
--
--   * **خدمةٌ لم يتعلّق بها شيء** — لا فاتورة ولا موعد ولا اتفاقية ولا جلسة
--     ولا مطالبة ولا باقة… — تُحذف نهائيًّا، ومعها إعداداتها وحدها (فروعها،
--     مواردها، أكواد مطالباتها، أسعارها في قوائم الأسعار، ربطها بالأطباء،
--     وجودها في مجموعات الفوترة السريعة).
--   * **خدمةٌ عملت فعلًا** تُؤرشَف وتُعطَّل: تختفي من كلّ قائمة اختيار ومن
--     الكتالوج، وتبقى فواتيرها واتفاقياتها القديمة تشير إليها كما كانت.
--     وكودها يُحرَّر (`OLD-<الكود>-…`) ويُحفظ الأصليّ في `legacy_code` —
--     فلا يصطدم بكود خدمةٍ جديدة، ويبقى البحث به ممكنًا.
--
-- «الخدمات» هنا صنفا `service` و`lab_service`. المنتجات والأدوية والمستهلكات
-- لا تُمسّ. وإن كان منتجٌ يحمل كودًا من أكواد الملفّ توقّف كلّ شيء برسالة
-- تسمّيه — لا يُغيَّر كود منتجٍ بصمت، فتغييره يقطع مطابقة أوامر الشراء.
--
-- ── الأقسام ────────────────────────────────────────────────────────────────
--
-- كلّ قسمٍ في الملفّ فئةٌ في شجرة «فئات الخدمات» تحت «خدمات الأسنان»: يُعاد
-- استعمال الموجود بنفس الاسم، ويُنشأ الناقص. والفئات القديمة التي فرغت بهذا
-- الاستبدال تُعطَّل (لا تُحذف) فلا تظهر فارغةً في منتقي الخدمات.
--
-- ── قرارات على الملفّ ────────────────────────────────────────────────────
--
--   * الكود 122 مكرَّر في الملفّ: «وتد فايبر» و«جهاز كامل متحرك فيتاليوم».
--     يبقى 122 لوتد الفايبر (في تسلسل الحشوات 119–122)، ويأخذ الجهاز الكامل
--     203 — أوّل رقمٍ حرّ بعد آخر الملفّ. يُغيَّر من الكتالوج إن شئت.
--   * «تنظيف تحت اللثة» مذكور مرّتين بكودين (110 الوقائية، 201 الجراحة)،
--     فيُدخل مرّتين كما في الملفّ.
--   * المسافات الزائدة في الأسماء تُحذف، والأسماء تُكتب كما هي حرفيًّا.
--   * نوع الخدمة الطبّيّ: «الأشعة» radiology، «الإجازة المرضية» other،
--     والباقي dental.
--   * الضريبة: خاضعة بالنسبة الأساسية (لا إعفاء على الصنف). إعفاء المواطن
--     يُحسب على المريض وقت الفوترة كما هو.
--
-- ── الإعادة ────────────────────────────────────────────────────────────────
--
-- خدمةٌ حيّة بنفس الكود ونفس الاسم تُعدَّل في مكانها (السعر والقسم) ولا
-- تُستبدل — فتنفيذٌ ثانٍ لا يؤرشف ما أنشأه الأوّل ولا يكرّره.
--
-- ── بعد التنفيذ ────────────────────────────────────────────────────────────
--
-- رسائل NOTICE في آخر التنفيذ تذكر ما بقي يشير إلى خدماتٍ مؤرشفة من
-- **إعدادات** تحتاج مراجعة (قواعد رسوم الكشف، قواعد التغطية التأمينية،
-- الباقات، العروض، ربط فحوص المختبر والأشعة بالفوترة). تلك لا تُغيَّر هنا
-- تخمينًا: أيّ «كشف» جديد يحلّ محلّ القديم قرارُ المالك.
--
-- كلّه في معاملةٍ واحدة: أيّ خطأ يُسقط العملية كاملةً ولا يبقى نصف استبدال.
-- ============================================================================

begin;

create temp table _svc (
  code       text primary key,
  name_ar    text not null,
  name_en    text,
  price      numeric(12,2) not null,
  section    text not null,
  ord        int not null
) on commit drop;

create temp table _sec (
  name_ar      text primary key,
  name_en      text,
  service_type text not null,
  ord          int not null,
  value_id     uuid
) on commit drop;

insert into _sec (name_ar, name_en, service_type, ord) values
    ('قسم الكشفيات', 'Examinations', 'dental', 10),
    ('قسم الأشعة X-Ray', 'X-Ray', 'radiology', 20),
    ('قسم صحة الفم و الأسنان الوقائية', 'Preventive Dentistry', 'dental', 30),
    ('قسم الحشوات العلاجية و التجميلية', 'Restorative & Cosmetic Fillings', 'dental', 40),
    ('قسم التراكيب', 'Prosthodontics', 'dental', 50),
    ('قسم الأطفال Pediatric', 'Pediatric Dentistry', 'dental', 60),
    ('قسم العلاج التحفظي', 'Endodontics', 'dental', 70),
    ('قسم التقويم Orthodontic', 'Orthodontics', 'dental', 80),
    ('الجراحة Surgical', 'Surgery', 'dental', 90),
    ('إجازة مرضيه', 'Sick Leave', 'other', 100);

insert into _svc (code, name_ar, name_en, price, section, ord) values
    ('100', 'فتح الملف مجاناً', 'Open File', 0, 'قسم الكشفيات', 1),
    ('101', 'كشف الاستشاري', 'Consultation Revealed', 150, 'قسم الكشفيات', 2),
    ('102', 'كشف الاخصائي', 'Specialist Revealed', 100, 'قسم الكشفيات', 3),
    ('103', 'كشف الطبيب العام', 'General Doctor Revealed', 50, 'قسم الكشفيات', 4),
    ('104', 'أشعة بانوراما', 'Panorama X-Ray', 200, 'قسم الأشعة X-Ray', 5),
    ('105', 'أشعة سيفالوا', 'Cephalometric X-Ray', 150, 'قسم الأشعة X-Ray', 6),
    ('106', 'أشعة ذروية', 'Pre Apical X - Ray', 50, 'قسم الأشعة X-Ray', 7),
    ('107', 'إزاله الرواسب الجيرية', 'Scalling', 200, 'قسم صحة الفم و الأسنان الوقائية', 8),
    ('108', 'تلميع الأسنان', 'Polishing Tooth', 150, 'قسم صحة الفم و الأسنان الوقائية', 9),
    ('109', 'تبييض الأسنان بالليزر', 'Bleaching Tooth', 700, 'قسم صحة الفم و الأسنان الوقائية', 10),
    ('110', 'تنظيف تحت اللثة', 'Subgingival Scalling', 600, 'قسم صحة الفم و الأسنان الوقائية', 11),
    ('111', 'فلورايد موضعي', 'Flouride Gel', 150, 'قسم صحة الفم و الأسنان الوقائية', 12),
    ('112', 'حشوة بلاتين سطح واحد', 'Amalgm Filling CI Ι', 150, 'قسم الحشوات العلاجية و التجميلية', 13),
    ('113', 'حشوة بلاتين سطحين', 'Amalgm Filling CI P', 250, 'قسم الحشوات العلاجية و التجميلية', 14),
    ('114', 'حشوة بلاتين أكثر من سطحين', 'Amalgm Filling ( MOD )', 350, 'قسم الحشوات العلاجية و التجميلية', 15),
    ('115', 'حشوة تجميلية سطح واحد', 'Composite Filling CI Ι', 250, 'قسم الحشوات العلاجية و التجميلية', 16),
    ('116', 'حشوة تجميلية سطحين', 'Composite Filling CI P', 300, 'قسم الحشوات العلاجية و التجميلية', 17),
    ('117', 'حشوة تجميلية أكثر من سطحين', 'Composite Filling ( MOD )', 400, 'قسم الحشوات العلاجية و التجميلية', 18),
    ('118', 'حشوة زيركون', 'Zercon Filling', 800, 'قسم الحشوات العلاجية و التجميلية', 19),
    ('119', 'ترميم سن', 'Buld Up', 400, 'قسم الحشوات العلاجية و التجميلية', 20),
    ('120', 'وتد صب', 'Scrow Castmade', 450, 'قسم الحشوات العلاجية و التجميلية', 21),
    ('121', 'وتد جاهز مصنوع', 'Scrow Post', 250, 'قسم الحشوات العلاجية و التجميلية', 22),
    ('122', 'وتد فايبر', 'Fiber Post', 150, 'قسم الحشوات العلاجية و التجميلية', 23),
    ('203', 'جهاز كامل متحرك فيتاليوم', 'Crom Cobalt Complete Denture', 1800, 'قسم التراكيب', 24),
    ('123', 'جهاز متحرك جزئي فيتاليوم', 'Crom Cobalt Partial Denture', 1500, 'قسم التراكيب', 25),
    ('124', 'طقم أكريل جزئي سنة واحدة بورسلين', 'P.D Porcaline Teeth', 650, 'قسم التراكيب', 26),
    ('125', 'طقم أكريل جزئي سنتين بورسلين', 'P.D Porcaline Tooth', 800, 'قسم التراكيب', 27),
    ('126', 'طقم أكريل جزئي ثلاثة أسنان بورسلين أو أكثر', 'P.D Porcaline more than Tow Teeth', 1000, 'قسم التراكيب', 28),
    ('127', 'طقم كلي أكريل بأسنان بورسلين', 'C.D With Porcaline', 2800, 'قسم التراكيب', 29),
    ('128', 'طقم جزئي أكريل', 'P.D Partial Acryl', 650, 'قسم التراكيب', 30),
    ('129', 'طقم كلي أكريل', 'C.D. Acryl', 2000, 'قسم التراكيب', 31),
    ('130', 'إصلاح طقم متحرك أو تبطين', 'Repair C.D', 300, 'قسم التراكيب', 32),
    ('131', 'وحدة زيركون', 'Zercon Crown', 900, 'قسم التراكيب', 33),
    ('132', 'وحدة بورسلين', 'Porcaline Crown', 650, 'قسم التراكيب', 34),
    ('133', 'وحدة بورسلين بمعدن ثمين', 'Gold Crown', 700, 'قسم التراكيب', 35),
    ('134', 'تركيب على زرعه', 'Implent Crown', 1500, 'قسم التراكيب', 36),
    ('135', 'تاج معدن أو تاج اكريل', 'St. St Crown Or Acryl Crown', 450, 'قسم التراكيب', 37),
    ('136', 'تاج معدن', 'Stanless Steel Crown', 350, 'قسم التراكيب', 38),
    ('137', 'تاج مــــؤقت', 'Temporary Crown', 150, 'قسم التراكيب', 39),
    ('138', 'إزاله أو تلصيق تاج', 'Remove Or Cement Crown', 150, 'قسم التراكيب', 40),
    ('139', 'تركيب الماسة', 'Crystal Cement', 200, 'قسم التراكيب', 41),
    ('140', 'لومنير', 'Lumoner`s', 1300, 'قسم التراكيب', 42),
    ('141', 'فينير', 'Veneer s', 900, 'قسم التراكيب', 43),
    ('142', 'إيمبريس E-Max', 'Impries E-Max', 900, 'قسم التراكيب', 44),
    ('143', 'اسناب اون سمايل', 'Snap on Smile', 1800, 'قسم التراكيب', 45),
    ('144', 'طبعة الجنيت', 'Study Cast', 150, 'قسم التراكيب', 46),
    ('145', 'حشوة بلاتين', 'Amalgm Filling Pedo', 250, 'قسم الأطفال Pediatric', 47),
    ('146', 'حشوة كومبوزيت', 'Composite Filling', 350, 'قسم الأطفال Pediatric', 48),
    ('147', 'حشوة زجاجية ( GIF )', 'GIF Filling', 200, 'قسم الأطفال Pediatric', 49),
    ('148', 'علاج أعصاب ضرس خلفي (أطفال)', 'Endo Posterior Teeth', 350, 'قسم الأطفال Pediatric', 50),
    ('149', 'علاج أعصاب سن أمامي (أطفال)', 'Endo Anterior Teeth', 300, 'قسم الأطفال Pediatric', 51),
    ('150', 'قص اللثة لبزوغ سن دائم', 'Cut gums Pedo', 200, 'قسم الأطفال Pediatric', 52),
    ('151', 'علاج لتكملة نمو الجذر', 'Root Tretment', 1000, 'قسم الأطفال Pediatric', 53),
    ('152', 'حافظ مسافه', 'Space Maintainer', 350, 'قسم الأطفال Pediatric', 54),
    ('153', 'ترميم محافظة للأطفال', 'Fissure Sealant', 300, 'قسم الأطفال Pediatric', 55),
    ('154', 'فلورايد', 'Flowride Gel', 200, 'قسم الأطفال Pediatric', 56),
    ('155', 'سد الشقوق', 'Cloing incisions', 400, 'قسم الأطفال Pediatric', 57),
    ('156', 'خلع سن لبني', 'Extraction Deciduous', 100, 'قسم الأطفال Pediatric', 58),
    ('157', 'اعادة علاج عصب سن أمامي', 'Repair Endo - Anterior Teeth', 900, 'قسم العلاج التحفظي', 59),
    ('158', 'اعادة علاج عصب ضرس خلفي', 'Repair Endo - Posterior Teeth', 1200, 'قسم العلاج التحفظي', 60),
    ('159', 'علاج أعصاب ضرس خلفي', 'Endo Posterior Teeth', 900, 'قسم العلاج التحفظي', 61),
    ('160', 'علاج أعصاب سن أمامي', 'Endo Anterior Teeth', 700, 'قسم العلاج التحفظي', 62),
    ('161', 'تسكين ألم', 'Ramove Pain', 100, 'قسم العلاج التحفظي', 63),
    ('162', 'تقويم ثابت معدني', 'Fixed Orthodontic / Simple Case', 5000, 'قسم التقويم Orthodontic', 64),
    ('163', 'تقويم معدني ذاتي الربط', 'Fixed Orthodontic To Arch Self Ligating', 12000, 'قسم التقويم Orthodontic', 65),
    ('164', 'تقويم ثابت / حالة متوسطة', 'Fixed Orthodontic / Middle case', 7000, 'قسم التقويم Orthodontic', 66),
    ('165', 'تقويم ثابت / حالة صعبة', 'Fixed Orthodontic / Very big Case', 10000, 'قسم التقويم Orthodontic', 67),
    ('166', 'تقويم فك واحد', 'Fixed Orthodontic one arch', 2500, 'قسم التقويم Orthodontic', 68),
    ('167', 'تقويم شفاف', 'Inviselign', 18000, 'قسم التقويم Orthodontic', 69),
    ('168', 'تقويم تجميلي', 'Cosmetic Orthodontic', 1500, 'قسم التقويم Orthodontic', 70),
    ('169', 'شد تقويم أسنان', 'Tighten', 250, 'قسم التقويم Orthodontic', 71),
    ('170', 'تقويم كريستال', 'Orthodontic To Arch Crystal', 9000, 'قسم التقويم Orthodontic', 72),
    ('171', 'جهاز تقويم متحرك', 'Removable Retainer', 3500, 'قسم التقويم Orthodontic', 73),
    ('172', 'جهاز مانع مص الأصابع', 'Finger Sucking Prevention', 1500, 'قسم التقويم Orthodontic', 74),
    ('173', 'زرعه تقويميه مؤقته للدعم', 'Cosmetic Orthodontic Mini Screw', 700, 'قسم التقويم Orthodontic', 75),
    ('174', 'إزاله تقويم مع التلميع', 'Remove Bracket with Polishing', 700, 'قسم التقويم Orthodontic', 76),
    ('175', 'جهاز مثبت', 'Retainer', 1000, 'قسم التقويم Orthodontic', 77),
    ('176', 'جهاز رفع عضة', 'Occluded', 500, 'قسم التقويم Orthodontic', 78),
    ('177', 'جهاز موسع للفك', 'Expansion', 3100, 'قسم التقويم Orthodontic', 79),
    ('178', 'نايت جارد', 'Night Gurd', 800, 'قسم التقويم Orthodontic', 80),
    ('179', 'ربط الأسنان', 'O. M. Fixation', 600, 'قسم التقويم Orthodontic', 81),
    ('180', 'تركيبة حاصرة إضافية', 'Extra Bracket', 100, 'قسم التقويم Orthodontic', 82),
    ('181', 'جراحة ضرس عقل مدفون', 'Surgical Extraction Wisdom Teeth', 1400, 'الجراحة Surgical', 83),
    ('182', 'جراحة سن أمامي مدفون', 'Surgical Extraction Anterior Teeth', 1300, 'الجراحة Surgical', 84),
    ('183', 'خلع عادي ضرس خلفي', 'Extraction Posterior Teeth', 350, 'الجراحة Surgical', 85),
    ('184', 'خلع عادي سن أمامي', 'Extraction Anterior Teeth', 200, 'الجراحة Surgical', 86),
    ('185', 'خلع جراحي', 'Surgical Extraction', 600, 'الجراحة Surgical', 87),
    ('186', 'كشف ناب منطمر', 'Display Canine', 1500, 'الجراحة Surgical', 88),
    ('187', 'علاج إلتهاب بعد الخلع', 'Treatment After Extract', 100, 'الجراحة Surgical', 89),
    ('188', 'جراحة تجميلية', 'Cosmetic Surgery', 2200, 'الجراحة Surgical', 90),
    ('189', 'توريد اللثة للفكين', 'Gum supply', 1300, 'الجراحة Surgical', 91),
    ('190', 'جراحة زراعة لثة', 'Gum Implant Surgery', 2800, 'الجراحة Surgical', 92),
    ('191', 'جراحة زراعة عظم', 'Bone Implant Surgery', 3000, 'الجراحة Surgical', 93),
    ('192', 'زراعة سن', 'Implant For One Teeth', 5000, 'الجراحة Surgical', 94),
    ('193', 'تفريغ خراج', 'Surgical Open Absecc', 300, 'الجراحة Surgical', 95),
    ('194', 'جراحة إزالة كيس', 'Surgical Remove Cyst', 1000, 'الجراحة Surgical', 96),
    ('195', 'خلع جذر', 'Extraction Root', 200, 'الجراحة Surgical', 97),
    ('196', 'خلع جذرين و أكثر', 'Multibal Root`s Extraction', 250, 'الجراحة Surgical', 98),
    ('197', 'إزالة لحمية', 'Tissue Remove', 200, 'الجراحة Surgical', 99),
    ('198', 'إزالة خياطة', 'Suture Remove', 100, 'الجراحة Surgical', 100),
    ('199', 'قص لجام شفوي أو لساني', 'Cut Frenum', 1500, 'الجراحة Surgical', 101),
    ('200', 'جراحة وتجميل اللثة', 'Gum Surgery', 1800, 'الجراحة Surgical', 102),
    ('201', 'تنظيف تحت اللثة', 'Subgingival Scalling', 600, 'الجراحة Surgical', 103),
    ('202', 'إجازة مرضيه', 'Sick Leave', 50, 'إجازة مرضيه', 104);

do $$
declare
  v_org        uuid;
  v_cat        uuid;
  v_root       uuid;
  v_revenue    uuid;
  v_sec        record;
  v_val        uuid;
  v_conflict   text;
  v_old        uuid[];
  v_old_cats   uuid[];
  v_rec        record;
  v_n          bigint;
  v_item       record;
  v_kept       int := 0;
  v_kept_ids   uuid[] := '{}';
  v_deleted    int := 0;
  v_archived   int := 0;
  v_inserted   int := 0;
  v_cats_off   int := 0;
  v_live       int;
  v_cfg        text[] := array['item_branches','item_resources','item_claim_codes',
                               'item_stock_settings','price_list_items',
                               'doctor_services','quick_invoice_group_items'];
  v_t          text;
begin
  -- ── 1) المنشأة — باسمها أو بكونها الأولى، كما في SETUP_asnani_identity ──
  select id into v_org from public.organizations
   where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
   order by created_at limit 1;
  if v_org is null then
    select id into v_org from public.organizations order by created_at limit 1;
  end if;
  if v_org is null then
    raise exception 'لا توجد منشأة في هذه القاعدة';
  end if;

  -- ── 1ب) لا يُعاد بعد إضافة الجلدية ومعامل الأسنان (30/09) ──────────────
  -- هذا السكربت يستبدل **كلّ** الخدمات بقائمة الأسنان الـ104، فتشغيله بعد
  -- SETUP_asnani_derma_lab_services.sql يؤرشف خدمات الجلدية والمعامل الـ227.
  if exists (
    select 1
      from items i
      join lookup_values v on v.id = i.category_value_id
      left join lookup_values p on p.id = v.parent_value_id
     where i.organization_id = v_org
       and i.item_type in ('service', 'lab_service')
       and not coalesce(i.is_archived, false)
       and (v.name_ar in ('خدمات الجلدية', 'خدمات معامل الأسنان') or p.name_ar = 'خدمات الجلدية')
  ) then
    raise exception 'في المنشأة خدمات جلدية أو معامل أسنان حيّة — هذا السكربت يستبدل كلّ الخدمات فيؤرشفها. لا يُعاد تشغيله بعد 30/09.';
  end if;

  -- ── 2) لا يُغيَّر كود منتجٍ بصمت ────────────────────────────────────────
  select string_agg(format('%s «%s» (%s)', i.code, i.name_ar, i.item_type), '، ')
    into v_conflict
    from items i
   where i.organization_id = v_org
     and i.item_type not in ('service', 'lab_service')
     and btrim(i.code) in (select code from _svc);
  if v_conflict is not null then
    raise exception 'أصنافٌ ليست خدمات تحمل أكوادًا من ملفّ الخدمات: %. غيّر كودها من شاشة المخزون أولًا ثم أعد التنفيذ.', v_conflict;
  end if;

  -- ── 3) شجرة الفئات: «خدمات الأسنان» وأقسام الملفّ تحتها ─────────────────
  select id into v_cat from lookup_categories
   where key = 'item_categories'
   order by (organization_id = v_org) desc nulls last, organization_id nulls last
   limit 1;
  if v_cat is null then
    insert into lookup_categories (key, name_ar, name_en)
    values ('item_categories', 'فئات الأصناف والخدمات', 'Item Categories')
    returning id into v_cat;
  end if;

  select id into v_root from lookup_values
   where category_id = v_cat and parent_value_id is null
     and btrim(name_ar) = 'خدمات الأسنان'
   order by coalesce(is_disabled, false), created_at
   limit 1;
  if v_root is null then
    insert into lookup_values (category_id, name_ar, name_en, sort_order, extra)
    values (v_cat, 'خدمات الأسنان', 'Dental Services', 10,
            jsonb_build_object('specialty_code', 'simple_dental'))
    returning id into v_root;
  else
    update lookup_values set is_disabled = false where id = v_root;
  end if;

  for v_sec in select * from _sec order by ord loop
    v_val := null;
    select id into v_val from lookup_values
     where category_id = v_cat
       and regexp_replace(btrim(name_ar), '\s+', ' ', 'g') = v_sec.name_ar
     order by coalesce(is_disabled, false), created_at
     limit 1;
    if v_val is null then
      insert into lookup_values (category_id, name_ar, name_en, parent_value_id, sort_order)
      values (v_cat, v_sec.name_ar, v_sec.name_en, v_root, v_sec.ord)
      returning id into v_val;
    else
      update lookup_values
         set parent_value_id = v_root,
             name_ar         = v_sec.name_ar,
             name_en         = coalesce(nullif(btrim(name_en), ''), v_sec.name_en),
             sort_order      = v_sec.ord,
             is_disabled     = false
       where id = v_val;
    end if;
    update _sec set value_id = v_val where name_ar = v_sec.name_ar;
  end loop;

  -- ── 4) حساب الإيراد إن وُجد (كما في بيانات المنشأة الأولى) ──────────────
  begin
    select id into v_revenue from chart_of_accounts
     where organization_id = v_org and code = '4000' limit 1;
  exception when undefined_table or undefined_column then
    v_revenue := null;
  end;

  -- ── 5) ما يبقى في مكانه: خدمةٌ حيّة بنفس الكود ونفس الاسم ───────────────
  for v_item in
    select i.id, s.*
      from items i
      join _svc s on s.code = btrim(i.code)
                 and s.name_ar = regexp_replace(btrim(i.name_ar), '\s+', ' ', 'g')
     where i.organization_id = v_org
       and i.item_type = 'service'
       and not coalesce(i.is_archived, false)
  loop
    update items i
       set name_ar              = v_item.name_ar,
           name_en              = v_item.name_en,
           price                = v_item.price,
           category_value_id    = (select value_id from _sec where name_ar = v_item.section),
           medical_service_type = (select service_type from _sec where name_ar = v_item.section),
           is_disabled          = false,
           updated_at           = now()
     where i.id = v_item.id;
    delete from _svc where code = v_item.code;   -- لا يُنشأ ثانيةً
    v_kept_ids := v_kept_ids || v_item.id;
    v_kept := v_kept + 1;
  end loop;

  -- ── 6) الخدمات القديمة: كلّ خدمات المنشأة سوى ما بقي في مكانه ───────────
  select array_agg(i.id),
         array_agg(distinct i.category_value_id) filter (where i.category_value_id is not null)
    into v_old, v_old_cats
    from items i
   where i.organization_id = v_org
     and i.item_type in ('service', 'lab_service')
     and not (i.id = any(v_kept_ids));
  v_old := coalesce(v_old, '{}');

  -- أكواد القديمة تُحرَّر قبل إنشاء الجديدة (قيد تفرّد الكود في المنشأة)
  update items
     set legacy_code = coalesce(legacy_code, code),
         code        = 'OLD-' || btrim(code) || '-' || left(id::text, 8)
   where id = any(v_old)
     and btrim(code) in (select code from _svc);

  -- ما يشير إلى الخدمات القديمة — بالقيود الصريحة وبأسماء الأعمدة معًا (0188)
  create temp table _used (item_id uuid primary key) on commit drop;
  for v_rec in
    select cl.relname::text as tbl, att.attname::text as col
      from pg_constraint c
      join pg_class      cl  on cl.oid = c.conrelid
      join pg_namespace  ns  on ns.oid = cl.relnamespace
      join pg_class      rcl on rcl.oid = c.confrelid
      join unnest(c.conkey) as k(attnum) on true
      join pg_attribute  att on att.attrelid = c.conrelid and att.attnum = k.attnum
     where c.contype = 'f' and ns.nspname = 'public'
       and rcl.relname = 'items' and array_length(c.conkey, 1) = 1
    union
    select cl.relname::text, att.attname::text
      from pg_class cl
      join pg_namespace ns  on ns.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = cl.oid
     where cl.relkind in ('r', 'p') and ns.nspname = 'public'
       and att.attnum > 0 and not att.attisdropped
       and att.atttypid = 'uuid'::regtype
       and att.attname like '%item_id'
  loop
    continue when v_rec.tbl = 'items' or v_rec.tbl = any(v_cfg);
    execute format(
      'insert into _used select distinct %I from %I where %I = any($1) on conflict do nothing',
      v_rec.col, v_rec.tbl, v_rec.col)
      using v_old;
  end loop;

  -- ── 7) حذفٌ لما لم يعمل، وأرشفةٌ لما عمل ────────────────────────────────
  for v_item in
    select i.id, (u.item_id is not null) as used, coalesce(i.is_archived, false) as was_archived
      from items i left join _used u on u.item_id = i.id
     where i.id = any(v_old)
  loop
    if not v_item.used then
      begin
        foreach v_t in array v_cfg loop
          if to_regclass('public.' || v_t) is not null then
            execute format('delete from %I where item_id = $1', v_t) using v_item.id;
          end if;
        end loop;
        delete from items where id = v_item.id;
        v_deleted := v_deleted + 1;
        continue;
      exception when foreign_key_violation then
        -- جدولٌ فات الفحصَ يشير إليها: تُؤرشف بدل الحذف
        null;
      end;
    end if;

    update items
       set is_archived    = true,
           archived_at    = coalesce(archived_at, now()),
           archive_reason = coalesce(archive_reason, 'استبدال قائمة الخدمات بملفّ المالك'),
           is_disabled    = true,
           updated_at     = now()
     where id = v_item.id;
    if not v_item.was_archived then
      v_archived := v_archived + 1;
    end if;
  end loop;

  -- ── 8) الخدمات الجديدة ──────────────────────────────────────────────────
  insert into items (
    organization_id, item_type, code, name_ar, name_en, price, cost_price,
    category_value_id, medical_service_type, provider_role, requires_appointment,
    default_discount_percent, is_vat_exempt, is_disabled, revenue_account_id
  )
  select v_org, 'service', s.code, s.name_ar, s.name_en, s.price, 0,
         sec.value_id, sec.service_type, 'any', false,
         0, false, false, v_revenue
    from _svc s
    join _sec sec on sec.name_ar = s.section
   order by s.ord;
  get diagnostics v_inserted = row_count;

  -- ── 9) فئاتٌ فرغت بهذا الاستبدال تُعطَّل (لا تُحذف) ─────────────────────
  update lookup_values v
     set is_disabled = true
   where v.id = any(coalesce(v_old_cats, '{}'))
     and v.id <> v_root
     and not exists (select 1 from _sec s where s.value_id = v.id)
     and not exists (select 1 from items i
                      where i.category_value_id = v.id
                        and not coalesce(i.is_archived, false))
     and not coalesce(v.is_disabled, false);
  get diagnostics v_cats_off = row_count;

  -- ── 10) تحقّق: خدمات المنشأة الحيّة هي الملفّ بالضبط ─────────────────────
  select count(*) into v_live
    from items
   where organization_id = v_org
     and item_type in ('service', 'lab_service')
     and not coalesce(is_archived, false);
  if v_live <> v_kept + v_inserted or v_kept + v_inserted <> 104 then
    raise exception 'التحقّق فشل: الخدمات الحيّة % والمتوقّع 104 (بقي % وأُنشئ %)',
      v_live, v_kept, v_inserted;
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_org, auth.uid(), 'catalog', 'update', null, 'استبدال قائمة الخدمات',
          format('من ملفّ المالك: %s خدمة في 10 أقسام — أُنشئ %s، عُدّل في مكانه %s، حُذف %s قديمًا بلا أثر، أُرشف %s قديمًا له أثر، عُطّلت %s فئة فرغت',
                 104, v_inserted, v_kept, v_deleted, v_archived, v_cats_off));

  raise notice 'الخدمات: أُنشئ %، عُدّل في مكانه %، حُذف قديمًا %، أُرشف قديمًا %، فئات عُطّلت %',
    v_inserted, v_kept, v_deleted, v_archived, v_cats_off;

  -- ── 11) إعداداتٌ ما زالت تشير إلى خدماتٍ مؤرشفة — تحتاج قرارك ──────────
  for v_rec in
    select t.tbl, t.col, t.label
      from (values
        ('consultation_fee_rules',   'consultation_item_id', 'قواعد رسوم الكشف (خدمة الكشف)'),
        ('consultation_fee_rules',   'follow_up_item_id',    'قواعد رسوم الكشف (خدمة المراجعة)'),
        ('insurance_coverage_rules', 'item_id',              'قواعد التغطية التأمينية'),
        ('package_items',            'item_id',              'بنود الباقات'),
        ('offer_items',              'item_id',              'بنود العروض'),
        ('item_offers',              'item_id',              'عروض الأصناف'),
        ('lab_tests',                'billing_item_id',      'ربط فحوص المختبر بالفوترة'),
        ('radiology_exams',          'billing_item_id',      'ربط فحوص الأشعة بالفوترة'),
        ('doctor_services',          'item_id',              'خدمات الأطباء'),
        ('quick_invoice_group_items','item_id',              'مجموعات الفوترة السريعة')
      ) as t(tbl, col, label)
     where to_regclass('public.' || t.tbl) is not null
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.tbl and c.column_name = t.col)
  loop
    execute format(
      'select count(*) from %I x join items i on i.id = x.%I where i.organization_id = $1 and i.is_archived',
      v_rec.tbl, v_rec.col) into v_n using v_org;
    if v_n > 0 then
      raise notice 'راجِع: % — % سطر يشير إلى خدمةٍ مؤرشفة', v_rec.label, v_n;
    end if;
  end loop;
end $$;

commit;

-- ── عرض النتيجة ────────────────────────────────────────────────────────────
select coalesce(c.name_ar, '— بلا قسم —') as "القسم",
       count(*)                             as "عدد الخدمات",
       min(case when i.code ~ '^[0-9]+$' then i.code::int end) as "من كود",
       max(case when i.code ~ '^[0-9]+$' then i.code::int end) as "إلى كود"
  from items i
  left join lookup_values c on c.id = i.category_value_id
 where i.organization_id = coalesce(
         (select id from organizations
           where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
           order by created_at limit 1),
         (select id from organizations order by created_at limit 1))
   and i.item_type = 'service'
   and not coalesce(i.is_archived, false)
 group by c.name_ar, c.sort_order
 order by c.sort_order;
