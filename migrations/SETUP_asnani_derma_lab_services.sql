-- ============================================================================
-- SETUP — إضافة خدمات الجلدية ومعامل الأسنان من Kizen: مجمع أسناني المتميز الطبي
-- ============================================================================
--
-- ليست ترقيةً في التسلسل: بياناتُ منشأةٍ بعينها. قرار المالك (30/09/2026).
--
-- المصدر: kizen_services_2026-09-30.xlsx، ورقة «الخدمات»:
--   * «خدمات الجلدية»        162 خدمة في 13 فئة.
--   * «خدمات معامل الأسنان»   65 خدمة (D-Lab1 … D-Lab65).
-- لا يُمسّ: «خدمات الأسنان» (استُبدلت في 27/09 وتبقى كما هي)، و«أخرى».
--
-- ── إضافةٌ فقط ─────────────────────────────────────────────────────────────
--
-- لا يؤرشف ولا يحذف ولا يعدّل خدمةً قائمة. التحقّق في آخره يقارن بصمة كلّ
-- الأصناف الحيّة قبل الإضافة وبعدها، ويُلغي كلّ شيء إن تغيّر منها صفّ.
--
-- ── الأكواد ────────────────────────────────────────────────────────────────
--
--   * الجلدية: «الكود (باركود المصدر)» 300–458 كما في Kizen، إلّا الثلاثة
--     المكرّرة بين الفراكشنال والليزر — قرار المالك: الليزر يحتفظ بها،
--     والفراكشنال يأخذ رقمًا جديدًا:
--         ندبات حب الشباب في الوجه   451 → 459
--         ندبه صغيرة لجرح قديم       452 → 460
--         ندبه كبيرة لجرح قديم       453 → 461
--   * معامل الأسنان: «رقم الصنف في Kizen» (D-Lab1 … D-Lab65).
--   * `legacy_code` = «رقم الصنف في Kizen» للجميع.
--
-- الحارس: إن كان كودٌ منها يحمله صنفٌ حيّ آخر في ZainCare (خدمة أو منتج أو
-- دواء) يتوقّف كلّ شيء برسالةٍ تسمّيه. أمّا الصنف **المؤرشف** الذي يحمل
-- الكود — خدمةٌ قديمة أُرشفت في استبدال 27/09 — فيُحرَّر كوده بالطريقة
-- نفسها التي اتُّبعت يومها (`OLD-<الكود>-…` ويُحفظ الأصليّ في
-- `legacy_code`)، ولا يُمسّ فيه شيءٌ غير ذلك.
--
-- ── الأسماء والأسعار والنوع ────────────────────────────────────────────────
--
--   * «الاسم العربي» و«الاسم الإنجليزي» كما هما (المسافات الزائدة تُحذف).
--     إن غاب أحدهما يُستعمل الآخر — لا تُخترع ترجمة. أسماء المعامل في
--     Kizen إنجليزية وفي بعضها أخطاء إملائية (lMPLANT…) وتُنقل كما هي،
--     وتُصحَّح من الكتالوج إن شئت.
--   * السعر = «سعر المبيع»، والتكلفة = «سعر الشراء»، والخصم الافتراضي كما في
--     Kizen. الضريبة: خاضعة بالنسبة الأساسية كبقيّة الخدمات.
--   * الجلدية: نوع الصنف `service`، والنوع الطبّيّ `procedure`.
--   * المعامل: نوع الصنف `lab_service`، والنوع الطبّيّ `dental`.
--
-- ── الفئات ─────────────────────────────────────────────────────────────────
--
--   * «خدمات الجلدية» جذرٌ تحته 12 فئة كما في عمود «الفئة». الخدمة الوحيدة
--     التي فئتها في Kizen «خدمات الجلدية» نفسها (SHAVING) توضع على الجذر.
--   * «خدمات معامل الأسنان» جذرٌ مستقلّ.
--   * يُعاد استعمال فئةٍ موجودة بنفس الاسم (تحت الجذر أو بلا أب)، وتُفعَّل
--     إن كانت معطَّلة.
--
-- ── الإعادة ────────────────────────────────────────────────────────────────
--
-- خدمةٌ أُضيفت في تنفيذٍ سابق (الكود نفسه ورقم Kizen نفسه) تُترك كما هي،
-- فالتنفيذ الثاني لا يكرّر ولا يعدّل شيئًا.
--
-- كلّه في معاملةٍ واحدة: أيّ خطأ يُسقط العملية كاملة.
-- ============================================================================

begin;

do $$
declare
  v_org        uuid;
  v_cat        uuid;
  v_derma      uuid;
  v_lab        uuid;
  v_val        uuid;
  v_rec        record;
  v_conflict   text;
  v_before     text;
  v_after      text;
  v_released   int := 0;
  v_existing   int := 0;
  v_inserted   int := 0;
  v_live       int;
  v_revenue    uuid;
begin
  -- ── 1) المنشأة ─────────────────────────────────────────────────────────
  select id into v_org from public.organizations
   where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
   order by created_at limit 1;
  if v_org is null then
    raise exception 'لم تُعثر على منشأة «مجمع أسناني المتميز الطبي»';
  end if;

  -- ── 2) البيانات ────────────────────────────────────────────────────────
  create temp table _kz (
    kind      text not null,          -- derma | lab
    category  text,                   -- فئة الجلدية؛ null = على الجذر
    code      text primary key,
    kizen_no  text not null unique,
    name_ar   text not null,
    name_en   text,
    price     numeric(12,2) not null,
    cost      numeric(12,2) not null,
    discount  numeric(5,2) not null,
    ord       int not null
  ) on commit drop;

  insert into _kz (kind, category, code, kizen_no, name_ar, name_en, price, cost, discount, ord) values
      ('derma', 'BOTOX', '300', '477', 'بوتكس 3 مناطق', 'BOTOX 3 AREA', 1250.00, 0.00, 0.00, 1),
      ('derma', 'BOTOX', '301', '478', 'ب ت منطقة واحدة', 'BoTX 1 AREA', 500.00, 0.00, 0.00, 2),
      ('derma', 'BOTOX', '302', '479', 'منطقه واحده', 'BoTX ONE AREA', 750.00, 0.00, 0.00, 3),
      ('derma', 'BOTOX', '303', '480', 'فرط تعرقXOTOB', 'فرط تعرقXOTOB', 1500.00, 0.00, 0.00, 4),
      ('derma', 'BOTOX', '304', '481', 'ميزوبوتكس', 'MESOBOTOX', 500.00, 0.00, 0.00, 5),
      ('derma', 'BOTOX', '305', '482', 'بوتكس للرقبة + ميزو بوتكس', 'NECK BOTOX+MESOBOTO', 1000.00, 0.00, 0.00, 6),
      ('derma', 'COSMOTIC', '306', '483', 'خيوط الشد ميركل', 'MERCLE', 1500.00, 0.00, 0.00, 7),
      ('derma', 'COSMOTIC', '307', '484', 'خيوط الشد', 'THREADS ONE', 450.00, 0.00, 0.00, 8),
      ('derma', 'COSMOTIC', '308', '485', 'تفتيح مناطق حساسة', 'WHITTING DARK AREA', 270.00, 0.00, 0.00, 9),
      ('derma', 'COSMOTIC', '309', '486', 'تقطيع الندبات', 'SCAR TREATMENT', 600.00, 0.00, 0.00, 10),
      ('derma', 'COSMOTIC', '310', '487', 'كي اثاليل', 'CRYO', 150.00, 0.00, 0.00, 11),
      ('derma', 'COSMOTIC', '311', '488', 'ازالة تصبغات وجة اسبكترا', 'SPECTRA FACE', 400.00, 0.00, 0.00, 12),
      ('derma', 'COSMOTIC', '312', '489', 'ازالة تصبغات منطقة صغيرة', 'SMALL AREA PIGMENT RE', 400.00, 0.00, 0.00, 13),
      ('derma', 'COSMOTIC', '313', '490', 'ازالة تصبغات منطقة كبيرة', 'BIG AREA PIGMENT REMO', 800.00, 0.00, 0.00, 14),
      ('derma', 'COSMOTIC', '314', '491', 'ابر تفتيح موضعي', 'WHITING AREA INJECTIO', 500.00, 0.00, 0.00, 15),
      ('derma', 'COSMOTIC', '315', '492', 'خدمه مختارة جلدية', 'DERMA SECION', 500.00, 0.00, 0.00, 16),
      ('derma', 'COSMOTIC', '316', '493', 'باقة علاج الندبات )خلاياجزعية.ب', 'SCAR TREATMENT (STEM.', 1200.00, 0.00, 0.00, 17),
      ('derma', 'COSMOTIC', '317', '494', 'لاقة علاج الهالات) اينوفيالز لايت', 'EYE CIRCLES TREATMENT', 1500.00, 0.00, 0.00, 18),
      ('derma', 'COSMOTIC', '318', '495', 'باقة التساقط ) جلستين بلازما م', 'HAIR FALL TREATMENT', 2500.00, 0.00, 0.00, 19),
      ('derma', 'COSMOTIC', '319', '496', 'خيوط تجميل انف + بوتكس لفتح', 'NASAL THREAD + NASAL B', 1000.00, 0.00, 0.00, 20),
      ('derma', 'COSMOTIC', '320', '497', 'خيوط رفع الحواجب + بوتكس', 'خيوط رفع الحواجب + بوتكس', 2200.00, 0.00, 0.00, 21),
      ('derma', 'COSMOTIC', '321', '498', '4 خيوط رفع او شد + 2 خيط', '4 خيوط رفع او شد + 2 خيط', 1600.00, 0.00, 0.00, 22),
      ('derma', 'DERMA', '322', '499', '3 ]جلسات تنظيف يشرة وتشق', 'EID PACK', 350.00, 0.00, 0.00, 23),
      ('derma', 'DERMA', '323', '500', 'كريم التقشير', 'COOLD PEEL CREAM', 700.00, 0.00, 0.00, 24),
      ('derma', 'DERMA', '324', '501', 'وندر LIP شفايف', 'WONDER LIP', 350.00, 0.00, 0.00, 25),
      ('derma', 'DERMA', '325', '502', 'لايتنج برسبلي', 'lighting perspely', 1600.00, 0.00, 0.00, 26),
      ('derma', 'DERMA', '326', '503', 'استكما rich + botox +filler', 'استكما rich + botox +filler', 5200.00, 0.00, 0.00, 27),
      ('derma', 'DERMA', '327', '504', 'ابرة السبع نجوم', 'PERCIPELLY', 1800.00, 0.00, 0.00, 28),
      ('derma', 'DERMA', '328', '505', 'تشقير ظهر وبطن', 'تشقير ظهر وبطن', 900.00, 0.00, 0.00, 29),
      ('derma', 'DERMA', '329', '506', 'فليشيا', 'Filicia', 4000.00, 0.00, 0.00, 30),
      ('derma', 'DERMA', '330', '507', 'ماك ديرمول', 'MAC DERMOL', 1350.00, 0.00, 0.00, 31),
      ('derma', 'DERMA', '331', '508', 'ميزوثيرابي للكفين', 'METHOTHERAPY PALM', 800.00, 0.00, 0.00, 32),
      ('derma', 'DERMA', '332', '509', 'ميزوثيرابي كفين', 'MESOTHERAPY PALM', 1000.00, 0.00, 0.00, 33),
      ('derma', 'DERMA', '333', '510', 'باشيو', 'BACIO', 1200.00, 0.00, 0.00, 34),
      ('derma', 'DERMA', '334', '511', 'ابرة السابير ) ابرة اليسا)', 'ابرة السابير ) ابرة اليسا)', 1500.00, 0.00, 0.00, 35),
      ('derma', 'DERMA', '335', '512', 'اكسوزوم', 'EXOSOME', 1000.00, 0.00, 0.00, 36),
      ('derma', 'DERMA', '336', '513', 'الياقوت', 'YAQOOT', 2000.00, 0.00, 0.00, 37),
      ('derma', 'DERMA', '337', '514', 'اكسير الشباب', 'SAPPIRE', 1500.00, 0.00, 0.00, 38),
      ('derma', 'DERMA', '338', '515', 'iبيو', 'bio eye', 600.00, 0.00, 0.00, 39),
      ('derma', 'FASCIAL CL', '339', '516', 'تنظيف بشرة', 'FACE CLEANING', 200.00, 0.00, 0.00, 40),
      ('derma', 'FILLER', '340', '517', 'فيللر جوفيدرم', 'FILLER JUVEDERM', 1400.00, 0.00, 0.00, 41),
      ('derma', 'FILLER', '341', '518', 'فيللر )نيوفيل / فيلمد.... )', 'FILLER ( NEUV.FILMED', 1250.00, 0.00, 0.00, 42),
      ('derma', 'FILLER', '342', '519', 'بلوريال', 'بلوريال', 1000.00, 0.00, 0.00, 43),
      ('derma', 'FILLER', '343', '520', 'جوفيديرم او الياكسين فيللر', 'JUVEDERM OR ALEXIN FIL', 1500.00, 0.00, 0.00, 44),
      ('derma', 'FILLER', '344', '521', 'سكين فبلل او كيسنس فيللر', 'CAISENS FILLER OR SKIN', 1500.00, 0.00, 0.00, 45),
      ('derma', 'FILLER', '345', '522', 'هياكورب فيللر', 'FILLER HYACORP', 3500.00, 0.00, 0.00, 46),
      ('derma', 'FILLER', '346', '523', 'ميزوفيللر شفايف +ليزر شنب م', 'MESOFILLER LIPS +MOUS', 699.00, 0.00, 0.00, 47),
      ('derma', 'FILLER', '347', '524', 'فيلر خفسات أو بكيني او يدين', 'فيلر خفسات أو بكيني او يدين', 2500.00, 0.00, 0.00, 48),
      ('derma', 'FILLER', '348', '525', '3 مل فيلر جوفيديرم او اليكسا', '3 مل فيلر جوفيديرم او اليكسا', 3500.00, 0.00, 0.00, 49),
      ('derma', 'FILLER', '349', '526', '3 مل فيلر كايسنس او سكين', '3 مل فيلر كايسنس او سكين', 3000.00, 0.00, 0.00, 50),
      ('derma', 'FILLER', '350', '527', '1 مل فيلر فيل ميد +تفتيح ها', '1 مل فيلر فيل ميد +تفتيح ها', 1400.00, 0.00, 0.00, 51),
      ('derma', 'FILLER', '351', '528', 'عرص الصديقات 1 مل لكل ش', 'عرص الصديقات 1 مل لكل ش', 1200.00, 0.00, 0.00, 52),
      ('derma', 'FILLER', '353', '530', '4 مل فيلر- جوفيديرم أو اليك', '4 مل فيلر- جوفيديرم أو اليك', 4500.00, 0.00, 0.00, 53),
      ('derma', 'FILLER', '354', '531', '4 مل فيلر- فيل ميد او سكين', '4 مل فيلر- فيل ميد او سكين', 4000.00, 0.00, 0.00, 54),
      ('derma', 'FILLER', '355', '532', 'فيلر بكيني او يدين + تقشير', 'فيلر بكيني او يدين + تقشير', 3000.00, 0.00, 0.00, 55),
      ('derma', 'FRACTIONAL', '459', '410', 'ندبات حب الشباب في الوجه', 'ندبات حب الشباب في الوجه', 400.00, 0.00, 0.00, 56),
      ('derma', 'FRACTIONAL', '460', '411', 'ندبه صغيرة لجرح قديم', 'ندبه صغيرة لجرح قديم', 100.00, 0.00, 0.00, 57),
      ('derma', 'FRACTIONAL', '461', '412', 'ندبه كبيرة لجرح قديم', 'ندبه كبيرة لجرح قديم', 500.00, 0.00, 0.00, 58),
      ('derma', 'FRACTIONAL', '454', '413', 'STRETCH MARKS BIG', 'STRETCH MARKS BIG', 800.00, 0.00, 0.00, 59),
      ('derma', 'FRACTIONAL', '455', '414', 'STRETCH MARKS SMALL', 'STRETCH MARKS SMALL', 500.00, 0.00, 0.00, 60),
      ('derma', 'FRACTIONAL', '456', '415', 'زوائد جلديه', 'زوائد جلديه', 100.00, 0.00, 0.00, 61),
      ('derma', 'FRACTIONAL', '457', '416', 'ازالة الثالول', 'ازالة الثالول', 300.00, 0.00, 0.00, 62),
      ('derma', 'M3', '391', '568', 'تنظيف بشرة 3M', 'تنظيف بشرة 3M', 350.00, 0.00, 0.00, 63),
      ('derma', 'M3', '392', '569', 'M3للابطين', 'M3للابطين', 750.00, 0.00, 0.00, 64),
      ('derma', 'M3', '393', '570', 'M3لنصف الظهر', 'M3لنصف الظهر', 800.00, 0.00, 0.00, 65),
      ('derma', 'PEELING', '394', '571', 'تقشير بارد وجه', 'COOLD PEELING FACE', 900.00, 0.00, 0.00, 66),
      ('derma', 'PEELING', '395', '572', 'تقشير بارد ابطين او اكواع', 'COOLD PEELING UNDERAR', 650.00, 0.00, 0.00, 67),
      ('derma', 'PEELING', '396', '573', 'تقشير بكيني او ركب او ايدي', 'COLD PEELING BIKINI OR', 900.00, 0.00, 0.00, 68),
      ('derma', 'PEELING', '397', '574', 'تقشير بارد للضهر', 'COLD PEEL BACK', 1400.00, 0.00, 0.00, 69),
      ('derma', 'PEELING', '398', '575', 'تقشير بارد البكيني او تحت الابط', 'COOLD PEELING BIKINI O', 399.00, 0.00, 0.00, 70),
      ('derma', 'PEELING', '399', '576', 'تقشير بارد البكيني وجوانب الافخ', 'COOLD PEELING ELBOW', 499.00, 0.00, 0.00, 71),
      ('derma', 'PEELING', '400', '577', 'تقشير بارد ركب و اكواع', 'COOLD PEELING KNEE +', 599.00, 0.00, 0.00, 72),
      ('derma', 'PEELING', '401', '578', 'تقشير بارد اسباني بكيني او', 'تقشير بارد اسباني بكيني او', 600.00, 0.00, 0.00, 73),
      ('derma', 'PEELING', '402', '579', 'تقشير بارد اسباني للابطين', 'تقشير بارد اسباني للابطين', 500.00, 0.00, 0.00, 74),
      ('derma', 'PEELING', '403', '580', 'تقشير بارد اسباني للاكواع بد', 'تقشير بارد اسباني للاكواع بد', 400.00, 0.00, 0.00, 75),
      ('derma', 'PLASMA', '404', '581', 'بلازما ريجين', 'REGEN LAB PLASMA PRP', 875.00, 0.00, 0.00, 76),
      ('derma', 'PLASMA', '405', '582', 'بلازما ذهبية ريجين لاب', 'PASMA REGEN LAB GOLDE', 1350.00, 0.00, 0.00, 77),
      ('derma', 'PLASMA', '406', '583', 'بلازما بيوتين', 'PLASMA BIOTIN', 900.00, 0.00, 0.00, 78),
      ('derma', 'PLASMA', '407', '584', 'بلازما بروموايطاليا', 'PLASMA PROMO ITALY GO', 900.00, 0.00, 0.00, 79),
      ('derma', 'PLASMA', '408', '585', 'بلازما درموريجين', 'DERMO REGEN PLASMA', 750.00, 0.00, 0.00, 80),
      ('derma', 'PLASMA', '409', '586', 'جلسة بلازما شعر +ميزو لل', 'جلسة بلازما شعر +ميزو لل', 1000.00, 0.00, 0.00, 81),
      ('derma', 'SCARLET', '410', '587', 'جلسة سكارليت', 'SCARLET', 1000.00, 0.00, 0.00, 82),
      ('derma', 'SCARLET', '411', '588', 'سكارليت مع ميزوثيرابي', 'SCARLET + METHOTHERA', 1000.00, 0.00, 0.00, 83),
      ('derma', 'SCARLET', '412', '589', 'سكارليت + توريد شفايف +بوتو', 'SCARLET +LIPS +BOTOX 1', 1099.00, 0.00, 0.00, 84),
      ('derma', 'laser', '352', '529', 'جلسه ازاله التاتو TATTOO REMOVAL', 'جلسه ازاله التاتو TATTOO REMOVAL', 300.00, 0.00, 0.00, 85),
      ('derma', 'laser', '356', '533', 'جلسة جسم كامل بظهر وبطن', 'LASER FULL BODY WITH', 650.00, 0.00, 0.00, 86),
      ('derma', 'laser', '357', '534', 'جلستين جسم كامل بظهر وبطن', 'LASER 2 FULL BODY WITH', 1400.00, 0.00, 0.00, 87),
      ('derma', 'laser', '358', '535', 'ثلاث جلسات جسم كامل بظهر', 'LASER 3 FULL BODY WITH', 2000.00, 0.00, 0.00, 88),
      ('derma', 'laser', '359', '536', 'اربع جلسات جسم كامل بظهر و', 'LASER 4FULL BODY WITH', 2500.00, 0.00, 0.00, 89),
      ('derma', 'laser', '360', '537', 'خمس جلسات جسم كامل بظه', 'LASER 5 FULL BODY WITH', 2900.00, 0.00, 0.00, 90),
      ('derma', 'laser', '361', '538', 'ست جلسات جسم كامل بظهر', 'LASER 6 FULL BODY WIT', 3200.00, 0.00, 0.00, 91),
      ('derma', 'laser', '362', '539', 'جلسة جسم كامل بدون ظهر و', 'LASER FULL BODY WITH OUT', 550.00, 0.00, 0.00, 92),
      ('derma', 'laser', '363', '540', 'جلستين جسم كامل بدون ظهر', 'LASER 2 FULL BODY WITH OUT', 1200.00, 0.00, 0.00, 93),
      ('derma', 'laser', '364', '541', 'ثلاث جسم كامل بدون ظهر وبط', 'LASER 3 FULL BODY WITH OUT', 1700.00, 0.00, 0.00, 94),
      ('derma', 'laser', '365', '542', 'اربع جسم كامل بدون ظهر وبطن', 'LASER 4 FULL BODY WITH OUT', 2100.00, 0.00, 0.00, 95),
      ('derma', 'laser', '366', '543', 'خمس جسم كامل بدون ظهر وب', 'LASER 5 FULL BODY WITH OUT', 2450.00, 0.00, 0.00, 96),
      ('derma', 'laser', '367', '544', 'ست جسم كامل بدون ظهر وبط', 'LASER 6 FULL BODY WITH OUT', 2750.00, 0.00, 0.00, 97),
      ('derma', 'laser', '368', '545', 'ليزر تشقير حواجب', 'LASER EYE BROW', 150.00, 0.00, 0.00, 98),
      ('derma', 'laser', '369', '546', 'جلسة كربوني', 'LASER CARPONY', 200.00, 0.00, 0.00, 99),
      ('derma', 'laser', '370', '547', 'ليزر منطقة صغيرة )بكيني او ابط', 'LASER BIKINI OR UNDER A', 250.00, 0.00, 0.00, 100),
      ('derma', 'laser', '371', '548', 'ليزر منطقة كبيرة', 'LASER B LARG AREA', 300.00, 0.00, 0.00, 101),
      ('derma', 'laser', '372', '549', 'ليزر تشقير وجة', 'LASER FACE BLONDING', 250.00, 0.00, 0.00, 102),
      ('derma', 'laser', '373', '550', 'حافظ مسافة الليزر الشخصية م', 'LASER DISTANSE CAGE si', 100.00, 0.00, 0.00, 103),
      ('derma', 'laser', '374', '551', 'حافظ مسافة الليزر الشخصية م', 'LASER DISTANSE CAGE si', 100.00, 0.00, 0.00, 104),
      ('derma', 'laser', '375', '552', 'ليزر شنب', 'mousstach laser', 100.00, 0.00, 0.00, 105),
      ('derma', 'laser', '376', '553', 'جلسه واحدة منطقه صغيرة SMALL AREA', 'جلسه واحدة منطقه صغيرة SMALL AREA', 200.00, 0.00, 0.00, 106),
      ('derma', 'laser', '377', '554', 'بكيني و ابطين', 'LASER BIKINI + UNDERAR', 500.00, 0.00, 0.00, 107),
      ('derma', 'laser', '378', '555', 'ليزر يدين كامله او رجلين كامله', 'LASER FULL ARMS OR FUL', 500.00, 0.00, 0.00, 108),
      ('derma', 'laser', '379', '556', 'ليزر ساقين او نصف ايدي', 'LASER LEG OR HALF ARM', 500.00, 0.00, 0.00, 109),
      ('derma', 'laser', '380', '557', 'كربوني مع تشقير وجه', 'LASER CARPONY + FACE', 500.00, 0.00, 0.00, 110),
      ('derma', 'laser', '381', '558', 'تشقير وجه مع ليزر حواجب', 'FACE BLONDING + EYE BR', 500.00, 0.00, 0.00, 111),
      ('derma', 'laser', '382', '559', '3 جلسات ارجل كامله او ازرع كا', '3LASER FULL ARM OR FUL', 499.00, 0.00, 0.00, 112),
      ('derma', 'laser', '383', '560', '3 جلسات نصف ارجل او نصف ازر', 'HALF LEG OR HALF ARM', 399.00, 0.00, 0.00, 113),
      ('derma', 'laser', '384', '561', 'جلستين ليزر منطقة صغيرة', 'جلستين ليزر منطقة صغيرة', 400.00, 0.00, 0.00, 114),
      ('derma', 'laser', '385', '562', 'جلستين ليزر منطقة متوسطة', 'جلستين ليزر منطقة متوسطة', 600.00, 0.00, 0.00, 115),
      ('derma', 'laser', '386', '563', 'جلستين ليزر منطقة كبيرة +', 'جلستين ليزر منطقة كبيرة +', 800.00, 0.00, 0.00, 116),
      ('derma', 'laser', '387', '564', 'تشقير وجه أو حواجب +نضارة', 'تشقير وجه أو حواجب +نضارة', 300.00, 0.00, 0.00, 117),
      ('derma', 'laser', '388', '565', 'جلستين جسم كامل', 'جلستين جسم كامل', 1400.00, 0.00, 0.00, 118),
      ('derma', 'laser', '389', '566', '6 جلسات جسم كامل', '6 جلسات جسم كامل', 3200.00, 0.00, 0.00, 119),
      ('derma', 'laser', '390', '567', '6جلسات بدون ظهر وبطن', '6جلسات بدون ظهر وبطن', 2750.00, 0.00, 0.00, 120),
      ('derma', 'laser', '451', '398', 'جلسه واحدة لمنطقه كبيره BIG AREA', 'جلسه واحدة لمنطقه كبيره BIG AREA', 300.00, 0.00, 0.00, 121),
      ('derma', 'laser', '452', '399', 'جلسه تحديد دقن مع الرتوش DETERMIN THE CHIN', 'جلسه تحديد دقن مع الرتوش DETERMIN THE CHIN', 200.00, 0.00, 0.00, 122),
      ('derma', 'laser', '453', '400', '3جلسات تحديد دقن مع الرتوش 3DETERMIN THE CHIN', '3جلسات تحديد دقن مع الرتوش 3DETERMIN THE CHIN', 600.00, 0.00, 0.00, 123),
      ('derma', 'ابر النضارة', '413', '590', 'جلسة خلايا جزعية', 'STEM CELL', 730.00, 0.00, 0.00, 124),
      ('derma', 'ابر النضارة', '414', '591', 'جلسة انوفيال', 'INNOVIAL', 1450.00, 0.00, 0.00, 125),
      ('derma', 'ابر النضارة', '415', '592', 'جلسة نيوفاوند ) بروفاوند )', 'NEOFOUND // PROFOUND', 1350.00, 0.00, 0.00, 126),
      ('derma', 'ابر النضارة', '416', '593', 'جلسة بروفايلو', 'PROPHILO', 1500.00, 0.00, 0.00, 127),
      ('derma', 'ابر النضارة', '417', '594', 'جلسة هيدرو ديلوكس', 'HYDRODELOX', 1500.00, 0.00, 0.00, 128),
      ('derma', 'ابر النضارة', '418', '595', 'جلسة هيدرو', 'HYDRO SECION', 1100.00, 0.00, 0.00, 129),
      ('derma', 'ابر النضارة', '419', '596', 'فلاش.', '.FLASH', 500.00, 0.00, 0.00, 130),
      ('derma', 'ابر النضارة', '420', '597', 'ريفيتال II', 'RIVITAL II', 900.00, 0.00, 0.00, 131),
      ('derma', 'ابر النضارة', '421', '598', 'ميزوثيرابي الكود الابيض', 'WHITE CODE', 450.00, 0.00, 0.00, 132),
      ('derma', 'ابر النضارة', '422', '599', 'ميزو الخلايا البنفسجيه للشعر', 'ميزو الخلايا البنفسجيه للشعر', 750.00, 0.00, 0.00, 133),
      ('derma', 'ابر النضارة', '423', '600', 'جلسة ميزوثيرابي عين او شفاي', 'MESOTHERAPY EYE OR LIP', 300.00, 0.00, 0.00, 134),
      ('derma', 'ابر النضارة', '424', '601', 'ميزوثيرابي وجه', 'ميزوثيرابي وجه', 450.00, 0.00, 0.00, 135),
      ('derma', 'ابر النضارة', '425', '602', 'جلسه درما بن', 'derma pen', 150.00, 0.00, 0.00, 136),
      ('derma', 'ابر النضارة', '426', '603', 'هيالورنيك اسيد + درما بن', 'HYALOURINC + DERMA PE', 750.00, 0.00, 0.00, 137),
      ('derma', 'ابر النضارة', '427', '604', 'خلايا جزعيه اسبانيه مع القلم ال', 'SPAIN STEM CELL WITH D', 1500.00, 0.00, 0.00, 138),
      ('derma', 'ابر النضارة', '428', '605', 'بروفايلو او هيدروديلوكس مع م', 'PROFHILO OR HYDRODEL', 2500.00, 0.00, 0.00, 139),
      ('derma', 'ابر النضارة', '429', '606', 'ابرة دروثي', 'DORTHY', 2000.00, 0.00, 0.00, 140),
      ('derma', 'ابر النضارة', '430', '607', '3جلسات هالات +كربوني', '3 EYE CIR + CARPONY', 1199.00, 0.00, 0.00, 141),
      ('derma', 'ابر النضارة', '431', '608', 'ايرة الريتش', 'RICH INJECTION', 5000.00, 0.00, 0.00, 142),
      ('derma', 'ابر النضارة', '432', '609', 'جلستين ميزو توريد شفايف او', 'جلستين ميزو توريد شفايف او', 400.00, 0.00, 0.00, 143),
      ('derma', 'ابر النضارة', '433', '610', 'جلستين ميزو اذابة لغلوغ او ل', 'جلستين ميزو اذابة لغلوغ او ل', 700.00, 0.00, 0.00, 144),
      ('derma', 'ابر النضارة', '434', '611', 'جلسة خلايا جذعية +ديرما ب', 'جلسة خلايا جذعية +ديرما ب', 900.00, 0.00, 0.00, 145),
      ('derma', 'ابر النضارة', '435', '612', 'دورثي او بروفايلو او هايدروديلو', 'دورثي او بروفايلو او هايدروديلو', 1600.00, 0.00, 0.00, 146),
      ('derma', 'ابر النضارة', '436', '613', 'جلسة انوفيال +كربوني مجانا', 'جلسة انوفيال +كربوني مجانا', 1300.00, 0.00, 0.00, 147),
      ('derma', 'ابر النضارة', '437', '614', 'جلسة الريتش 01 مل +ميزو', 'جلسة الريتش 01 مل +ميزو', 3300.00, 0.00, 0.00, 148),
      ('derma', 'ابر النضارة', '438', '615', 'بيولفت', 'BIO LIFT', 1600.00, 0.00, 0.00, 149),
      ('derma', 'ابر النضارة', '439', '616', 'ابرة السبع نجوم + تفتيح هالا', 'ابرة السبع نجوم + تفتيح هالا', 1500.00, 0.00, 0.00, 150),
      ('derma', 'ابر النضارة', '440', '617', 'ديرما بن + ريفيتال او نيوفاوند', 'ديرما بن + ريفيتال او نيوفاوند', 994.00, 0.00, 0.00, 151),
      ('derma', 'ابر النضارة', '441', '618', 'جلسة نصارة ميزو للوجه + د', 'جلسة نصارة ميزو للوجه + د', 400.00, 0.00, 0.00, 152),
      ('derma', 'ابر النضارة', '442', '619', 'جلسة ميزو اذابة لغلوغ', 'جلسة ميزو اذابة لغلوغ', 500.00, 0.00, 0.00, 153),
      ('derma', 'ابر النضارة', '443', '620', 'ابرة الياقوت 5 مل للنضارة و ال', 'ابرة الياقوت 5 مل للنضارة و ال', 1399.00, 0.00, 0.00, 154),
      ('derma', 'ابر النضارة', '444', '621', 'جلسة ريتش 01 مل + ميزو ه', 'جلسة ريتش 01 مل + ميزو ه', 3500.00, 0.00, 0.00, 155),
      ('derma', 'ابر النضارة', '445', '622', 'جلسة فليشيا + كربوني نضار', 'جلسة فليشيا + كربوني نضار', 3000.00, 0.00, 0.00, 156),
      ('derma', 'ابر النضارة', '446', '623', 'بوتكس 3 مناطق + بروفايلو او', 'بوتكس 3 مناطق + بروفايلو او', 2500.00, 0.00, 0.00, 157),
      ('derma', 'ابر النضارة', '447', '624', 'ابرة الياقوت 5 مل + بوتكس', 'ابرة الياقوت 5 مل + بوتكس', 2700.00, 0.00, 0.00, 158),
      ('derma', 'ابر النضارة', '448', '625', 'نضارة السبع نجوم + نضارة كر', 'نضارة السبع نجوم + نضارة كر', 1500.00, 0.00, 0.00, 159),
      ('derma', 'ابر النضارة', '449', '626', 'جلستين ابرة السالمون AND', 'جلستين ابرة السالمون AND', 1500.00, 0.00, 0.00, 160),
      ('derma', 'ابر النضارة', '450', '627', 'سكارليت + خلايا جذعية', 'سكارليت + خلايا جذعية', 1500.00, 0.00, 0.00, 161),
      ('derma', null, '458', '417', 'SHAVING', 'SHAVING', 50.00, 0.00, 0.00, 162),
      ('lab', null, 'D-Lab1', 'D-Lab1', 'lMPLANT', 'lMPLANT', 450.00, 0.00, 0.00, 163),
      ('lab', null, 'D-Lab2', 'D-Lab2', 'lMPLANT WlTH ZlRCON CROWN', 'lMPLANT WlTH ZlRCON CROWN', 600.00, 0.00, 0.00, 164),
      ('lab', null, 'D-Lab3', 'D-Lab3', 'ZIRCON CROWN', 'ZIRCON CROWN', 500.00, 0.00, 0.00, 165),
      ('lab', null, 'D-Lab4', 'D-Lab4', 'ZER PRESS', 'ZER PRESS', 600.00, 0.00, 0.00, 166),
      ('lab', null, 'D-Lab5', 'D-Lab5', 'E -MAX LENSES VEREER', 'E -MAX LENSES VEREER', 500.00, 0.00, 0.00, 167),
      ('lab', null, 'D-Lab6', 'D-Lab6', 'lMPRESS CROWN', 'lMPRESS CROWN', 500.00, 0.00, 0.00, 168),
      ('lab', null, 'D-Lab7', 'D-Lab7', 'P.F.M. PREClOUS METAL', 'P.F.M. PREClOUS METAL', 700.00, 0.00, 0.00, 169),
      ('lab', null, 'D-Lab8', 'D-Lab8', 'P.F.M. NON PREClOUS METAL C.D. SlGN', 'P.F.M. NON PREClOUS METAL C.D. SlGN', 250.00, 0.00, 0.00, 170),
      ('lab', null, 'D-Lab9', 'D-Lab9', 'TELESCOPlC CROWN', 'TELESCOPlC CROWN', 400.00, 0.00, 0.00, 171),
      ('lab', null, 'D-Lab10', 'D-Lab10', 'SURVWYED CROWN', 'SURVWYED CROWN', 350.00, 0.00, 0.00, 172),
      ('lab', null, 'D-Lab11', 'D-Lab11', 'FULL METAL CROWN', 'FULL METAL CROWN', 150.00, 0.00, 0.00, 173),
      ('lab', null, 'D-Lab12', 'D-Lab12', 'ZlRCON POST & COR', 'ZlRCON POST & COR', 400.00, 0.00, 0.00, 174),
      ('lab', null, 'D-Lab13', 'D-Lab13', 'NON PRECIOUS METAL POST & CORE', 'NON PRECIOUS METAL POST & CORE', 150.00, 0.00, 0.00, 175),
      ('lab', null, 'D-Lab14', 'D-Lab14', 'MERYLAND BRlDGE', 'MERYLAND BRlDGE', 400.00, 0.00, 0.00, 176),
      ('lab', null, 'D-Lab15', 'D-Lab15', 'PREClOUS POST &CORE', 'PREClOUS POST &CORE', 450.00, 0.00, 0.00, 177),
      ('lab', null, 'D-Lab16', 'D-Lab16', 'lNLY - ONL Y lMPRESS', 'lNLY - ONL Y lMPRESS', 450.00, 0.00, 0.00, 178),
      ('lab', null, 'D-Lab17', 'D-Lab17', 'VENEER lMPRESS', 'VENEER lMPRESS', 450.00, 0.00, 0.00, 179),
      ('lab', null, 'D-Lab18', 'D-Lab18', 'TEMPORARY CROWN', 'TEMPORARY CROWN', 60.00, 0.00, 0.00, 180),
      ('lab', null, 'D-Lab19', 'D-Lab19', 'Porcelain Shoulder', 'Porcelain Shoulder', 75.00, 0.00, 0.00, 181),
      ('lab', null, 'D-Lab20', 'D-Lab20', 'DlAGNOSTlC WEX- UP (per unit)', 'DlAGNOSTlC WEX- UP (per unit)', 50.00, 0.00, 0.00, 182),
      ('lab', null, 'D-Lab21', 'D-Lab21', 'STUDY CAST', 'STUDY CAST', 40.00, 0.00, 0.00, 183),
      ('lab', null, 'D-Lab22', 'D-Lab22', 'IMPRESS CROWN', 'IMPRESS CROWN', 500.00, 0.00, 0.00, 184),
      ('lab', null, 'D-Lab23', 'D-Lab23', 'ATTCHMENTS', 'ATTCHMENTS', 300.00, 0.00, 0.00, 185),
      ('lab', null, 'D-Lab24', 'D-Lab24', 'HLlXEBLE RARTlAL DENTURE', 'HLlXEBLE RARTlAL DENTURE', 450.00, 0.00, 0.00, 186),
      ('lab', null, 'D-Lab25', 'D-Lab25', 'NATURAL TOTALLY ONE LAW', 'NATURAL TOTALLY ONE LAW', 450.00, 0.00, 0.00, 187),
      ('lab', null, 'D-Lab26', 'D-Lab26', 'PARTlAL CHROME COBALY', 'PARTlAL CHROME COBALY', 450.00, 0.00, 0.00, 188),
      ('lab', null, 'D-Lab27', 'D-Lab27', 'ACRYlL C FULL DENTURE', 'ACRYlL C FULL DENTURE', 350.00, 0.00, 0.00, 189),
      ('lab', null, 'D-Lab28', 'D-Lab28', 'ACRTlLC PARTlAL DENTURE', 'ACRTlLC PARTlAL DENTURE', 250.00, 0.00, 0.00, 190),
      ('lab', null, 'D-Lab29', 'D-Lab29', 'NlGHT WHlTE', 'NlGHT WHlTE', 100.00, 0.00, 0.00, 191),
      ('lab', null, 'D-Lab30', 'D-Lab30', 'NlGHT GUARD', 'NlGHT GUARD', 150.00, 0.00, 0.00, 192),
      ('lab', null, 'D-Lab31', 'D-Lab31', 'REPAl R', 'REPAl R', 100.00, 0.00, 0.00, 193),
      ('lab', null, 'D-Lab32', 'D-Lab32', 'SPEClAL TRY', 'SPEClAL TRY', 30.00, 0.00, 0.00, 194),
      ('lab', null, 'D-Lab33', 'D-Lab33', 'ORDlNARY RELlNlNG ONE JAW', 'ORDlNARY RELlNlNG ONE JAW', 120.00, 0.00, 0.00, 195),
      ('lab', null, 'D-Lab34', 'D-Lab34', 'SOFT RELlNE ONE JAW', 'SOFT RELlNE ONE JAW', 250.00, 0.00, 0.00, 196),
      ('lab', null, 'D-Lab35', 'D-Lab35', 'RETAlNER', 'RETAlNER', 200.00, 0.00, 0.00, 197),
      ('lab', null, 'D-Lab36', 'D-Lab36', 'RETAlNER WlTH EXPANSlON SCREW', 'RETAlNER WlTH EXPANSlON SCREW', 250.00, 0.00, 0.00, 198),
      ('lab', null, 'D-Lab37', 'D-Lab37', 'SPACE MOUNT AlNOUS', 'SPACE MOUNT AlNOUS', 150.00, 0.00, 0.00, 199),
      ('lab', null, 'D-Lab38', 'D-Lab38', 'TRANS PALATAL ARCH', 'TRANS PALATAL ARCH', 200.00, 0.00, 0.00, 200),
      ('lab', null, 'D-Lab39', 'D-Lab39', 'ACTlVATOR', 'ACTlVATOR', 300.00, 0.00, 0.00, 201),
      ('lab', null, 'D-Lab40', 'D-Lab40', 'Q.H', 'Q.H', 300.00, 0.00, 0.00, 202),
      ('lab', null, 'D-Lab41', 'D-Lab41', 'NANCY APPLlANCE', 'NANCY APPLlANCE', 200.00, 0.00, 0.00, 203),
      ('lab', null, 'D-Lab42', 'D-Lab42', 'ACRYLlC BlTE PLAN', 'ACRYLlC BlTE PLAN', 180.00, 0.00, 0.00, 204),
      ('lab', null, 'D-Lab43', 'D-Lab43', 'LlNGUAL ARCH', 'LlNGUAL ARCH', 180.00, 0.00, 0.00, 205),
      ('lab', null, 'D-Lab44', 'D-Lab44', 'lMPLANT', 'lMPLANT', 400.00, 0.00, 0.00, 206),
      ('lab', null, 'D-Lab45', 'D-Lab45', 'TEMP PLATE', 'TEMP PLATE', 100.00, 0.00, 0.00, 207),
      ('lab', null, 'D-Lab46', 'D-Lab46', 'PRECIOUS METAL POST AND COR', 'PRECIOUS METAL POST AND COR', 500.00, 0.00, 0.00, 208),
      ('lab', null, 'D-Lab47', 'D-Lab47', 'SET UP TEETH', 'SET UP TEETH', 50.00, 0.00, 0.00, 209),
      ('lab', null, 'D-Lab48', 'D-Lab48', 'FLEXIBLE MATERIAL SIZE M', 'FLEXIBLE MATERIAL SIZE M', 40.00, 0.00, 0.00, 210),
      ('lab', null, 'D-Lab49', 'D-Lab49', 'FLEXIBLE MATERIAL SIZE S', 'FLEXIBLE MATERIAL SIZE S', 30.00, 0.00, 0.00, 211),
      ('lab', null, 'D-Lab50', 'D-Lab50', 'EXIBLE MATERIAL SIZE L', 'EXIBLE MATERIAL SIZE L', 60.00, 0.00, 0.00, 212),
      ('lab', null, 'D-Lab51', 'D-Lab51', 'GINGIVA', 'GINGIVA', 50.00, 0.00, 0.00, 213),
      ('lab', null, 'D-Lab52', 'D-Lab52', 'PORCELAIN GINGIVA', 'PORCELAIN GINGIVA', 50.00, 0.00, 0.00, 214),
      ('lab', null, 'D-Lab53', 'D-Lab53', 'ACRYLIC FULL DENTURE', 'ACRYLIC FULL DENTURE', 500.00, 0.00, 0.00, 215),
      ('lab', null, 'D-Lab54', 'D-Lab54', 'lMPLANT', 'lMPLANT', 400.00, 0.00, 0.00, 216),
      ('lab', null, 'D-Lab55', 'D-Lab55', 'IMPLANT WITH ZIRCON CROWN', 'IMPLANT WITH ZIRCON CROWN', 500.00, 0.00, 0.00, 217),
      ('lab', null, 'D-Lab56', 'D-Lab56', 'BIEACHING TRAY', 'BIEACHING TRAY', 100.00, 0.00, 0.00, 218),
      ('lab', null, 'D-Lab57', 'D-Lab57', 'ADDITIONAL ACRYLIC TEETH', 'ADDITIONAL ACRYLIC TEETH', 50.00, 0.00, 0.00, 219),
      ('lab', null, 'D-Lab58', 'D-Lab58', 'POST & CORE', 'POST & CORE', 120.00, 0.00, 0.00, 220),
      ('lab', null, 'D-Lab59', 'D-Lab59', 'SURGICAL STEND', 'SURGICAL STEND', 200.00, 0.00, 0.00, 221),
      ('lab', null, 'D-Lab60', 'D-Lab60', 'ADDITIONAL TOOTH', 'ADDITIONAL TOOTH', 50.00, 0.00, 0.00, 222),
      ('lab', null, 'D-Lab61', 'D-Lab61', 'KEG INDEX IMPRESSION', 'KEG INDEX IMPRESSION', 30.00, 0.00, 0.00, 223),
      ('lab', null, 'D-Lab62', 'D-Lab62', 'CROWN Cleaming', 'CROWN Cleaming', 25.00, 0.00, 0.00, 224),
      ('lab', null, 'D-Lab63', 'D-Lab63', 'SNAP ON', 'SNAP ON', 0.00, 0.00, 0.00, 225),
      ('lab', null, 'D-Lab64', 'D-Lab64', 'parshal duntur flixabul', 'parshal duntur flixabul', 0.00, 0.00, 0.00, 226),
      ('lab', null, 'D-Lab65', 'D-Lab65', 'جهاز موسع للفك', 'Expansion', 0.00, 0.00, 0.00, 227);

  if (select count(*) from _kz) <> 227 then
    raise exception 'البيانات المضمَّنة ليست 227 خدمة';
  end if;

  -- ── 3) ما أُضيف في تنفيذٍ سابق يُترك كما هو ─────────────────────────────
  delete from _kz k
   using items i
   where i.organization_id = v_org
     and btrim(i.code) = k.code
     and i.legacy_code = k.kizen_no
     and not coalesce(i.is_archived, false);
  get diagnostics v_existing = row_count;

  -- ── 4) الحارس: كودٌ يحمله صنفٌ حيّ آخر ────────────────────────────────
  select string_agg(format('%s «%s» (%s)', i.code, i.name_ar, i.item_type), '، ' order by i.code)
    into v_conflict
    from items i
    join _kz k on k.code = btrim(i.code)
   where i.organization_id = v_org
     and not coalesce(i.is_archived, false);
  if v_conflict is not null then
    raise exception 'أكوادٌ من ملفّ Kizen يحملها صنفٌ حيّ في ZainCare: %. لم يُضف شيء — راجع المالك.', v_conflict;
  end if;

  -- بصمة الأصناف الحيّة قبل أيّ كتابة — للتحقّق أن لا شيء قائمًا تغيّر
  select md5(coalesce(string_agg(i::text, '|' order by i.id), ''))
    into v_before
    from items i
   where i.organization_id = v_org and not coalesce(i.is_archived, false);

  -- الصنف المؤرشف الذي يحمل الكود يُحرَّر كوده (كما في استبدال 27/09)
  update items i
     set legacy_code = coalesce(i.legacy_code, i.code),
         code        = 'OLD-' || btrim(i.code) || '-' || left(i.id::text, 8)
    from _kz k
   where i.organization_id = v_org
     and coalesce(i.is_archived, false)
     and btrim(i.code) = k.code;
  get diagnostics v_released = row_count;

  -- ── 5) الفئات ──────────────────────────────────────────────────────────
  select id into v_cat from lookup_categories
   where key = 'item_categories'
   order by (organization_id = v_org) desc nulls last, organization_id nulls last
   limit 1;
  if v_cat is null then
    raise exception 'لا لائحة «item_categories» — نفّذ SETUP_asnani_service_catalog.sql أوّلًا';
  end if;

  -- جذر الجلدية
  select id into v_derma from lookup_values
   where category_id = v_cat and parent_value_id is null
     and regexp_replace(btrim(name_ar), '\s+', ' ', 'g') = 'خدمات الجلدية'
   order by coalesce(is_disabled, false), created_at
   limit 1;
  if v_derma is null then
    insert into lookup_values (category_id, name_ar, name_en, sort_order, extra)
    values (v_cat, 'خدمات الجلدية', 'Dermatology Services', 200,
            jsonb_build_object('specialty_code', 'derma'))
    returning id into v_derma;
  else
    update lookup_values
       set is_disabled = false,
           extra = case when coalesce(extra->>'specialty_code', '') = ''
                        then coalesce(extra, '{}'::jsonb) || jsonb_build_object('specialty_code', 'derma')
                        else extra end
     where id = v_derma;
  end if;

  -- فئات الجلدية تحت جذرها
  create temp table _cats (name_ar text primary key, ord int not null, value_id uuid) on commit drop;
  insert into _cats (name_ar, ord) values
      ('BOTOX', 10),
      ('COSMOTIC', 20),
      ('DERMA', 30),
      ('FASCIAL CL', 40),
      ('FILLER', 50),
      ('FRACTIONAL', 60),
      ('M3', 70),
      ('PEELING', 80),
      ('PLASMA', 90),
      ('SCARLET', 100),
      ('laser', 110),
      ('ابر النضارة', 120);

  for v_rec in select * from _cats order by ord loop
    v_val := null;
    select id into v_val from lookup_values
     where category_id = v_cat
       and id <> v_derma
       and (parent_value_id = v_derma or parent_value_id is null)
       and lower(regexp_replace(btrim(name_ar), '\s+', ' ', 'g')) = lower(v_rec.name_ar)
     order by (parent_value_id = v_derma) desc nulls last, coalesce(is_disabled, false), created_at
     limit 1;
    if v_val is null then
      insert into lookup_values (category_id, name_ar, name_en, parent_value_id, sort_order, extra)
      values (v_cat, v_rec.name_ar, v_rec.name_ar, v_derma, v_rec.ord,
              jsonb_build_object('specialty_code', 'derma'))
      returning id into v_val;
    else
      update lookup_values
         set parent_value_id = v_derma,
             is_disabled     = false,
             extra = case when coalesce(extra->>'specialty_code', '') = ''
                          then coalesce(extra, '{}'::jsonb) || jsonb_build_object('specialty_code', 'derma')
                          else extra end
       where id = v_val;
    end if;
    update _cats set value_id = v_val where name_ar = v_rec.name_ar;
  end loop;

  -- جذر معامل الأسنان
  select id into v_lab from lookup_values
   where category_id = v_cat and parent_value_id is null
     and regexp_replace(btrim(name_ar), '\s+', ' ', 'g') = 'خدمات معامل الأسنان'
   order by coalesce(is_disabled, false), created_at
   limit 1;
  if v_lab is null then
    insert into lookup_values (category_id, name_ar, name_en, sort_order, extra)
    values (v_cat, 'خدمات معامل الأسنان', 'Dental Lab Services', 300,
            jsonb_build_object('specialty_code', 'simple_dental'))
    returning id into v_lab;
  else
    update lookup_values set is_disabled = false where id = v_lab;
  end if;

  -- ── 6) حساب الإيراد إن وُجد (كما في SETUP_asnani_service_catalog) ──────
  begin
    select id into v_revenue from chart_of_accounts
     where organization_id = v_org and code = '4000' limit 1;
  exception when undefined_table or undefined_column then
    v_revenue := null;
  end;

  -- ── 7) الإضافة ─────────────────────────────────────────────────────────
  insert into items (
    organization_id, item_type, code, legacy_code, name_ar, name_en, price, cost_price,
    category_value_id, medical_service_type, provider_role, requires_appointment,
    default_discount_percent, is_vat_exempt, is_disabled, revenue_account_id
  )
  select v_org,
         case k.kind when 'lab' then 'lab_service' else 'service' end,
         k.code, k.kizen_no, k.name_ar, k.name_en, k.price, k.cost,
         case when k.kind = 'lab' then v_lab
              when k.category is null then v_derma
              else (select c.value_id from _cats c where c.name_ar = k.category) end,
         case k.kind when 'lab' then 'dental' else 'procedure' end,
         'any', false, k.discount, false, false, v_revenue
    from _kz k
   order by k.ord;
  get diagnostics v_inserted = row_count;

  -- ── 8) التحقّق ─────────────────────────────────────────────────────────
  -- (أ) لا صنفَ قائمًا تغيّر
  select md5(coalesce(string_agg(i::text, '|' order by i.id), ''))
    into v_after
    from items i
   where i.organization_id = v_org and not coalesce(i.is_archived, false)
     and i.id not in (select x.id from items x join _kz k on k.code = x.code
                       where x.organization_id = v_org);
  if v_after <> v_before then
    raise exception 'التحقّق فشل: تغيّر صنفٌ قائم — أُلغي كلّ شيء';
  end if;

  -- (ب) كلّ الـ227 موجودة حيّةً بأكوادها
  select count(*) into v_live
    from items i
   where i.organization_id = v_org
     and not coalesce(i.is_archived, false)
     and i.legacy_code is not null
     and (   (i.item_type = 'lab_service' and i.code ~ '^D-Lab[0-9]+$' and i.category_value_id = v_lab)
          or (i.item_type = 'service' and i.code ~ '^[0-9]+$' and i.code::int between 300 and 461
              and i.category_value_id in (select value_id from _cats union all select v_derma)));
  if v_live <> 227 or v_inserted + v_existing <> 227 then
    raise exception 'التحقّق فشل: الخدمات المضافة الحيّة % والمتوقّع 227 (أُضيف % وكان موجودًا %)',
      v_live, v_inserted, v_existing;
  end if;

  if v_inserted > 0 then
    insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
    values (v_org, auth.uid(), 'catalog', 'add', null, 'خدمات الجلدية ومعامل الأسنان',
            format('من Kizen: أُضيف %s خدمة (الجلدية 162، المعامل 65) — كان موجودًا %s، حُرِّر كود %s صنفٍ مؤرشف',
                   v_inserted, v_existing, v_released));
  end if;
end $$;

commit;

-- ── النتيجة: عدد الخدمات في كلّ فئة مقابل ورقة «ملخص» ─────────────────────
with expected(category, n) as (
  values
      ('BOTOX', 6),
      ('COSMOTIC', 16),
      ('DERMA', 17),
      ('FASCIAL CL', 1),
      ('FILLER', 15),
      ('FRACTIONAL', 7),
      ('M3', 3),
      ('PEELING', 10),
      ('PLASMA', 6),
      ('SCARLET', 3),
      ('laser', 39),
      ('ابر النضارة', 38),
      ('— الجذر —', 1),
      ('خدمات معامل الأسنان', 65)
), org as (
  select id from organizations
   where name in ('مجمع أسناني المتميز الطبي', 'مجمع زين الطبي')
   order by created_at limit 1
), actual as (
  select case when p.name_ar = 'خدمات الجلدية' then v.name_ar
              when v.name_ar = 'خدمات الجلدية' then '— الجذر —'
              else v.name_ar end as category,
         count(*) as n
    from items i
    join lookup_values v on v.id = i.category_value_id
    left join lookup_values p on p.id = v.parent_value_id
   where i.organization_id = (select id from org)
     and not coalesce(i.is_archived, false)
     and (v.name_ar in ('خدمات الجلدية', 'خدمات معامل الأسنان') or p.name_ar = 'خدمات الجلدية')
   group by 1
)
select coalesce(e.category, a.category)       as "الفئة",
       e.n                                    as "في Kizen",
       a.n                                    as "في ZainCare",
       case when e.n = a.n then 'مطابق' else 'مختلف' end as "الحالة"
  from expected e
  full join actual a on lower(a.category) = lower(e.category)
 order by 1;
