-- ---------------------------------------------------------------------------
-- 0047_icd10_seed.sql — بذرة أكواد ICD-10
-- ---------------------------------------------------------------------------
-- لماذا هذه الهجرة:
--   جدول `icd10_codes` أُنشئ في 0006، وشاشة `ReferenceData` ومكوّن `IcdPicker`
--   مبنيان بالكامل ويعملان — لكن التدقيق الشامل للقطات الـ133 أثبت أن الجدول
--   **فارغ تمامًا (0 صفوف) ولا توجد بذرة في أي هجرة سابقة**. وسياسته
--   `icd10_read_authenticated` قراءة فقط، فلا يستطيع العميل إضافة كود واحد.
--
--   النتيجة العملية: التشخيص المرمَّز معطّل كليًا. الطبيب يفتح مُنتقي ICD فلا
--   يجد شيئًا، و`patient_visit_diagnoses` يبقى فارغًا، ومطالبات التأمين التي
--   تشترط كود التشخيص (وهي الأغلب) تُرفض.
--
-- نطاق البذرة:
--   153 كودًا مختارًا لا 70,000. المجموعة الكاملة لا تفيد عيادة: تُبطئ البحث
--   وتُغرق الطبيب في أكواد لن يستعملها. المختار هنا يغطي ما يُشخَّص فعليًا في
--   العيادات الخارجية، مع **تغطية شبه كاملة لكتلة الأسنان K00–K14** لأن هذا
--   النظام أسناني بالدرجة الأولى.
--
-- الترميز:
--   أكواد منظمة الصحة العالمية (ICD-10 WHO) بصيغة 3–4 محارف، لا ICD-10-CM
--   الأمريكية — وهي الصيغة المعتمدة لدى مجلس الضمان الصحي (CCHI) في نماذج
--   UCAF/DCAF، فتُقبل كما هي في المطالبات.
--
-- `on conflict (code) do nothing`:
--   الهجرة قابلة لإعادة التشغيل، ولا تدهس أي كود أضافه المشغّل يدويًا في
--   القاعدة قبل تشغيلها. `diagnosis_group` يُملأ لأن الفهرس `idx_icd10_group`
--   مبني عليه وشاشة الاستعراض تصفّي به.
-- ---------------------------------------------------------------------------

insert into icd10_codes (code, diagnosis_group, name_en, name_ar) values
('K00.0', 'Dental', 'Anodontia', 'انعدام الأسنان الخلقي'),
  ('K00.1', 'Dental', 'Supernumerary teeth', 'أسنان زائدة'),
  ('K00.2', 'Dental', 'Abnormalities of size and form of teeth', 'شذوذ حجم وشكل الأسنان'),
  ('K00.6', 'Dental', 'Disturbances in tooth eruption', 'اضطرابات بزوغ الأسنان'),
  ('K00.7', 'Dental', 'Teething syndrome', 'متلازمة التسنين'),
  ('K01.0', 'Dental', 'Embedded teeth', 'أسنان مطمورة'),
  ('K01.1', 'Dental', 'Impacted teeth', 'أسنان منحشرة'),
  ('K02.0', 'Dental', 'Caries limited to enamel', 'تسوس مقتصر على الميناء'),
  ('K02.1', 'Dental', 'Caries of dentine', 'تسوس العاج'),
  ('K02.2', 'Dental', 'Caries of cementum', 'تسوس الملاط'),
  ('K02.3', 'Dental', 'Arrested dental caries', 'تسوس متوقف'),
  ('K02.5', 'Dental', 'Caries with pulp exposure', 'تسوس مع انكشاف اللب'),
  ('K02.9', 'Dental', 'Dental caries, unspecified', 'تسوس أسنان غير محدد'),
  ('K03.0', 'Dental', 'Excessive attrition of teeth', 'تآكل الأسنان المفرط (الاحتكاك)'),
  ('K03.1', 'Dental', 'Abrasion of teeth', 'سحل الأسنان'),
  ('K03.2', 'Dental', 'Erosion of teeth', 'تآكل الأسنان الكيميائي'),
  ('K03.3', 'Dental', 'Pathological resorption of teeth', 'امتصاص مرضي للأسنان'),
  ('K03.4', 'Dental', 'Hypercementosis', 'فرط الملاط'),
  ('K03.6', 'Dental', 'Deposits (accretions) on teeth', 'ترسبات على الأسنان (جير)'),
  ('K03.7', 'Dental', 'Posteruptive colour changes of dental hard tissues', 'تغيّر لون الأسنان بعد البزوغ'),
  ('K04.0', 'Dental', 'Pulpitis', 'التهاب اللب'),
  ('K04.1', 'Dental', 'Necrosis of pulp', 'نخر اللب'),
  ('K04.2', 'Dental', 'Pulp degeneration', 'تنكّس اللب'),
  ('K04.4', 'Dental', 'Acute apical periodontitis of pulpal origin', 'التهاب دواعم ذروي حاد لبّي المنشأ'),
  ('K04.5', 'Dental', 'Chronic apical periodontitis', 'التهاب دواعم ذروي مزمن'),
  ('K04.6', 'Dental', 'Periapical abscess with sinus', 'خراج حول ذروي مع ناسور'),
  ('K04.7', 'Dental', 'Periapical abscess without sinus', 'خراج حول ذروي بلا ناسور'),
  ('K05.0', 'Dental', 'Acute gingivitis', 'التهاب لثة حاد'),
  ('K05.1', 'Dental', 'Chronic gingivitis', 'التهاب لثة مزمن'),
  ('K05.2', 'Dental', 'Acute periodontitis', 'التهاب دواعم السن الحاد'),
  ('K05.3', 'Dental', 'Chronic periodontitis', 'التهاب دواعم السن المزمن'),
  ('K05.4', 'Dental', 'Periodontosis', 'داء الدواعم'),
  ('K05.6', 'Dental', 'Periodontal disease, unspecified', 'مرض دواعم غير محدد'),
  ('K06.0', 'Dental', 'Gingival recession', 'انحسار اللثة'),
  ('K06.1', 'Dental', 'Gingival enlargement', 'تضخم اللثة'),
  ('K06.2', 'Dental', 'Gingival lesions associated with trauma', 'آفات لثوية رضّية'),
  ('K07.0', 'Dental', 'Major anomalies of jaw size', 'شذوذ كبير في حجم الفك'),
  ('K07.1', 'Dental', 'Anomalies of jaw-cranial base relationship', 'شذوذ علاقة الفك بقاعدة الجمجمة'),
  ('K07.2', 'Dental', 'Anomalies of dental arch relationship', 'شذوذ علاقة الأقواس السنية'),
  ('K07.3', 'Dental', 'Anomalies of tooth position', 'شذوذ موضع الأسنان'),
  ('K07.4', 'Dental', 'Malocclusion, unspecified', 'سوء إطباق غير محدد'),
  ('K07.5', 'Dental', 'Dentofacial functional abnormalities', 'اضطرابات وظيفية سنية وجهية'),
  ('K07.6', 'Dental', 'Temporomandibular joint disorders', 'اضطرابات المفصل الصدغي الفكي'),
  ('K08.0', 'Dental', 'Exfoliation of teeth due to systemic causes', 'تساقط أسنان لأسباب جهازية'),
  ('K08.1', 'Dental', 'Loss of teeth due to accident or extraction', 'فقد أسنان بسبب حادث أو خلع'),
  ('K08.2', 'Dental', 'Atrophy of edentulous alveolar ridge', 'ضمور الحافة السنخية'),
  ('K08.3', 'Dental', 'Retained dental root', 'جذر سني متبقٍ'),
  ('K09.0', 'Dental', 'Developmental odontogenic cysts', 'كيسات سنّية المنشأ تطورية'),
  ('K09.1', 'Dental', 'Developmental (nonodontogenic) cysts of oral region', 'كيسات فموية غير سنّية المنشأ'),
  ('K10.2', 'Dental', 'Inflammatory conditions of jaws', 'حالات التهابية في الفكين'),
  ('K10.3', 'Dental', 'Alveolitis of jaws (dry socket)', 'التهاب السنخ الجاف'),
  ('K11.5', 'Dental', 'Sialolithiasis', 'حصيات لعابية'),
  ('K11.7', 'Dental', 'Disturbances of salivary secretion', 'اضطرابات الإفراز اللعابي'),
  ('K12.0', 'Dental', 'Recurrent oral aphthae', 'قلاع فموي متكرر'),
  ('K12.1', 'Dental', 'Other forms of stomatitis', 'أشكال أخرى من التهاب الفم'),
  ('K12.2', 'Dental', 'Cellulitis and abscess of mouth', 'التهاب نسيج خلوي وخراج بالفم'),
  ('K13.0', 'Dental', 'Diseases of lips', 'أمراض الشفتين'),
  ('K13.2', 'Dental', 'Leukoplakia and other disturbances of oral epithelium', 'طلاوة واضطرابات الظهارة الفموية'),
  ('K14.0', 'Dental', 'Glossitis', 'التهاب اللسان'),
  ('K14.3', 'Dental', 'Hypertrophy of tongue papillae', 'تضخم حليمات اللسان'),
  ('K14.6', 'Dental', 'Glossodynia', 'ألم اللسان'),
  ('E03.9', 'Endocrine', 'Hypothyroidism, unspecified', 'قصور الغدة الدرقية غير محدد'),
  ('E05.9', 'Endocrine', 'Thyrotoxicosis, unspecified', 'فرط نشاط الغدة الدرقية'),
  ('E10.9', 'Endocrine', 'Type 1 diabetes mellitus without complications', 'سكري النمط الأول بلا مضاعفات'),
  ('E11.9', 'Endocrine', 'Type 2 diabetes mellitus without complications', 'سكري النمط الثاني بلا مضاعفات'),
  ('E55.9', 'Endocrine', 'Vitamin D deficiency, unspecified', 'نقص فيتامين د'),
  ('E66.9', 'Endocrine', 'Obesity, unspecified', 'السمنة غير محددة'),
  ('E78.5', 'Endocrine', 'Hyperlipidaemia, unspecified', 'فرط شحوم الدم'),
  ('E86', 'Endocrine', 'Volume depletion (dehydration)', 'الجفاف ونقص الحجم'),
  ('D50.9', 'Blood', 'Iron deficiency anaemia, unspecified', 'فقر دم بعوز الحديد'),
  ('D64.9', 'Blood', 'Anaemia, unspecified', 'فقر دم غير محدد'),
  ('I10', 'Cardio', 'Essential (primary) hypertension', 'ارتفاع ضغط الدم الأساسي'),
  ('I25.9', 'Cardio', 'Chronic ischaemic heart disease, unspecified', 'داء قلبي إقفاري مزمن'),
  ('I48', 'Cardio', 'Atrial fibrillation and flutter', 'رجفان ورفرفة أذينية'),
  ('I50.9', 'Cardio', 'Heart failure, unspecified', 'قصور القلب غير محدد'),
  ('I83.9', 'Cardio', 'Varicose veins of lower extremities', 'دوالي الأطراف السفلية'),
  ('J00', 'Respiratory', 'Acute nasopharyngitis (common cold)', 'نزلة برد حادة'),
  ('J01.9', 'Respiratory', 'Acute sinusitis, unspecified', 'التهاب جيوب حاد'),
  ('J02.9', 'Respiratory', 'Acute pharyngitis, unspecified', 'التهاب بلعوم حاد'),
  ('J03.9', 'Respiratory', 'Acute tonsillitis, unspecified', 'التهاب لوزتين حاد'),
  ('J06.9', 'Respiratory', 'Acute upper respiratory infection, unspecified', 'التهاب تنفسي علوي حاد'),
  ('J18.9', 'Respiratory', 'Pneumonia, unspecified', 'ذات الرئة غير محددة'),
  ('J20.9', 'Respiratory', 'Acute bronchitis, unspecified', 'التهاب قصبات حاد'),
  ('J30.4', 'Respiratory', 'Allergic rhinitis, unspecified', 'التهاب أنف تحسسي'),
  ('J32.9', 'Respiratory', 'Chronic sinusitis, unspecified', 'التهاب جيوب مزمن'),
  ('J35.0', 'Respiratory', 'Chronic tonsillitis', 'التهاب لوزتين مزمن'),
  ('J45.9', 'Respiratory', 'Asthma, unspecified', 'الربو غير محدد'),
  ('J44.9', 'Respiratory', 'COPD, unspecified', 'داء انسداد رئوي مزمن'),
  ('K21.9', 'Digestive', 'GERD without oesophagitis', 'ارتجاع معدي مريئي بلا التهاب'),
  ('K29.7', 'Digestive', 'Gastritis, unspecified', 'التهاب معدة غير محدد'),
  ('K30', 'Digestive', 'Functional dyspepsia', 'عسر هضم وظيفي'),
  ('K52.9', 'Digestive', 'Noninfective gastroenteritis and colitis', 'التهاب معدي معوي غير إنتاني'),
  ('K57.9', 'Digestive', 'Diverticular disease of intestine', 'داء الرتوج'),
  ('K58.0', 'Digestive', 'Irritable bowel syndrome with diarrhoea', 'القولون العصبي مع إسهال'),
  ('K58.9', 'Digestive', 'Irritable bowel syndrome without diarrhoea', 'القولون العصبي بلا إسهال'),
  ('K59.0', 'Digestive', 'Constipation', 'الإمساك'),
  ('K64.9', 'Digestive', 'Haemorrhoids, unspecified', 'البواسير'),
  ('K80.2', 'Digestive', 'Calculus of gallbladder without cholecystitis', 'حصيات مرارية بلا التهاب'),
  ('K76.0', 'Digestive', 'Fatty (change of) liver', 'الكبد الدهني'),
  ('A09', 'Infection', 'Infectious gastroenteritis and colitis', 'التهاب معدي معوي إنتاني'),
  ('B34.9', 'Infection', 'Viral infection, unspecified', 'إنتان فيروسي غير محدد'),
  ('B35.9', 'Infection', 'Dermatophytosis, unspecified', 'سعفة جلدية'),
  ('B37.9', 'Infection', 'Candidiasis, unspecified', 'داء المبيضات'),
  ('N39.0', 'Urinary', 'Urinary tract infection, site not specified', 'التهاب مسالك بولية'),
  ('N20.0', 'Urinary', 'Calculus of kidney', 'حصاة كلوية'),
  ('N18.9', 'Urinary', 'Chronic kidney disease, unspecified', 'مرض كلوي مزمن'),
  ('N76.0', 'Gynae', 'Acute vaginitis', 'التهاب مهبل حاد'),
  ('N91.2', 'Gynae', 'Amenorrhoea, unspecified', 'انقطاع الطمث غير محدد'),
  ('N92.0', 'Gynae', 'Excessive and frequent menstruation', 'غزارة الطمث'),
  ('N94.6', 'Gynae', 'Dysmenorrhoea, unspecified', 'عسر الطمث'),
  ('N97.9', 'Gynae', 'Female infertility, unspecified', 'عقم أنثوي غير محدد'),
  ('O21.0', 'Obstetric', 'Mild hyperemesis gravidarum', 'قيء حملي خفيف'),
  ('Z34.9', 'Obstetric', 'Supervision of normal pregnancy, unspecified', 'متابعة حمل طبيعي'),
  ('M54.5', 'Musculoskeletal', 'Low back pain', 'ألم أسفل الظهر'),
  ('M54.2', 'Musculoskeletal', 'Cervicalgia', 'ألم رقبي'),
  ('M25.5', 'Musculoskeletal', 'Pain in joint', 'ألم مفصلي'),
  ('M17.9', 'Musculoskeletal', 'Gonarthrosis, unspecified', 'خشونة الركبة'),
  ('M79.1', 'Musculoskeletal', 'Myalgia', 'ألم عضلي'),
  ('M06.9', 'Musculoskeletal', 'Rheumatoid arthritis, unspecified', 'التهاب مفاصل رثوي'),
  ('M10.9', 'Musculoskeletal', 'Gout, unspecified', 'النقرس'),
  ('M81.9', 'Musculoskeletal', 'Osteoporosis, unspecified', 'هشاشة العظام'),
  ('G43.9', 'Neuro', 'Migraine, unspecified', 'الشقيقة'),
  ('G44.2', 'Neuro', 'Tension-type headache', 'صداع توتري'),
  ('G47.0', 'Neuro', 'Insomnia', 'الأرق'),
  ('F32.9', 'Psych', 'Depressive episode, unspecified', 'نوبة اكتئابية'),
  ('F41.1', 'Psych', 'Generalized anxiety disorder', 'اضطراب قلق معمم'),
  ('F41.9', 'Psych', 'Anxiety disorder, unspecified', 'اضطراب قلق غير محدد'),
  ('F51.0', 'Psych', 'Nonorganic insomnia', 'أرق غير عضوي'),
  ('H10.9', 'Eye', 'Conjunctivitis, unspecified', 'التهاب ملتحمة'),
  ('H25.9', 'Eye', 'Senile cataract, unspecified', 'الساد الشيخي'),
  ('H52.1', 'Eye', 'Myopia', 'قصر النظر'),
  ('H52.0', 'Eye', 'Hypermetropia', 'طول النظر'),
  ('H52.4', 'Eye', 'Presbyopia', 'طول النظر الشيخوخي'),
  ('H60.9', 'ENT', 'Otitis externa, unspecified', 'التهاب أذن خارجية'),
  ('H61.2', 'ENT', 'Impacted cerumen', 'انحشار الصملاخ'),
  ('H65.9', 'ENT', 'Nonsuppurative otitis media', 'التهاب أذن وسطى غير قيحي'),
  ('H66.9', 'ENT', 'Otitis media, unspecified', 'التهاب أذن وسطى'),
  ('L20.9', 'Skin', 'Atopic dermatitis, unspecified', 'التهاب جلد تأتبي'),
  ('L21.9', 'Skin', 'Seborrhoeic dermatitis, unspecified', 'التهاب جلد دهني'),
  ('L23.9', 'Skin', 'Allergic contact dermatitis', 'التهاب جلد تماسي تحسسي'),
  ('L30.9', 'Skin', 'Dermatitis, unspecified', 'التهاب جلد غير محدد'),
  ('L40.9', 'Skin', 'Psoriasis, unspecified', 'الصدفية'),
  ('L50.9', 'Skin', 'Urticaria, unspecified', 'الشرى'),
  ('L70.0', 'Skin', 'Acne vulgaris', 'حب الشباب'),
  ('L03.9', 'Skin', 'Cellulitis, unspecified', 'التهاب نسيج خلوي'),
  ('R05', 'Symptoms', 'Cough', 'السعال'),
  ('R10.4', 'Symptoms', 'Other and unspecified abdominal pain', 'ألم بطني غير محدد'),
  ('R11', 'Symptoms', 'Nausea and vomiting', 'غثيان وقيء'),
  ('R42', 'Symptoms', 'Dizziness and giddiness', 'دوار ودوخة'),
  ('R50.9', 'Symptoms', 'Fever, unspecified', 'حمى غير محددة'),
  ('R51', 'Symptoms', 'Headache', 'صداع'),
  ('R53', 'Symptoms', 'Malaise and fatigue', 'توعك وإرهاق'),
  ('T78.4', 'Symptoms', 'Allergy, unspecified', 'تحسس غير محدد'),
  ('Z00.0', 'Examination', 'General medical examination', 'فحص طبي عام'),
  ('Z01.2', 'Examination', 'Dental examination', 'فحص أسنان'),
  ('Z13.9', 'Examination', 'Special screening examination, unspecified', 'فحص مسحي'),
  ('Z76.0', 'Examination', 'Issue of repeat prescription', 'إصدار وصفة متكررة')
on conflict (code) do nothing;

-- لا فهرس للبحث بالاسم عمدًا.
--
-- كنتُ أضفتُ فهرسَي btree على `lower(name_en)` و`name_ar` بحجة تسريع بحث
-- المُنتقي — وهي حجة **خاطئة**: بحث المُنتقي `ilike '%نص%'` (بدل في الطرفين)،
-- وفهرس btree لا يخدمه إطلاقًا، ولا يخدم حتى `like 'نص%'` بلا
-- `text_pattern_ops` في ترتيب المحارف الافتراضي. التحقق بـ `enable_seqscan=off`
-- أظهر مسحًا تسلسليًا في الأشكال الخمسة كلها.
--
-- والجدول 157 صفًا: المسح التسلسلي دون المللي ثانية. فهرس لا يُستعمل تكلفة
-- صافية على كل كتابة، ووجوده يوهم القارئ بأن البحث مُفهرَس.
--
-- لو كبر الجدول لاحقًا (استيراد ICD-10 كاملًا)، الحل الصحيح فهرس GIN مع
-- `pg_trgm` لا btree.
