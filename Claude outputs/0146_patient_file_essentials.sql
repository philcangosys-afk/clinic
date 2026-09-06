-- ---------------------------------------------------------------------------
-- 0146 — أساسيات ملف المريض والفوترة السريعة وأكواد الخدمات القصيرة
--
-- يعالج ما رصده الاستعمال الفعليّ على شاشة «ملف المريض»:
--
--   ١) لوائح الجنسيات والمدن وجهات العمل: كانت تُزرع في ملفات (0028) ليست
--      ضمن مجلد `migrations/` المنفَّذ على القاعدة، فبقيت الفئة موجودة
--      وقائمتها شبه فارغة — «سعودي» نفسها غائبة عن قائمة الجنسية. الزرع
--      هنا **تكميليّ**: يضيف الناقص باسمه العربي ولا يمسّ ما أضافته المنشأة،
--      ولا يعيد تفعيل قيمة عطَّلها مسؤول عن قصد.
--
--   ٢) العمر بدل تاريخ الميلاد: الاستقبال يعرف عمر المريض ولا يعرف تاريخ
--      ميلاده. تبقى القاعدة تخزّن `birth_date` (كل الحسابات الطبية والتقارير
--      مبنيّة عليه) ويُضاف علَم `birth_date_is_estimated` يُميّز التاريخ
--      المشتقّ من عمرٍ مُدخَل عن تاريخ مأخوذ من الهوية — فلا يُقرأ تاريخ
--      تقديريّ كأنه موثَّق.
--
--   ٣) رقم الهوية فريد لكل منشأة: كان النظام يقبل فتح ملفَّين بنفس رقم
--      الهوية، فيتوزّع تاريخ المريض الطبي والمالي على ملفَّين ولا يرى الطبيب
--      إلا نصفه. يُفرض المنع في القاعدة بمُحفِّز (يعمل مهما كان مصدر الكتابة)
--      وبفهرس فريد مشروط حين تكون القاعدة نظيفة، ويُعرَض التكرار القائم في
--      منظور ليُدمَج يدويًا — ولا يُحذف ولا يُدمَج تلقائيًا.
--
--   ٤) أكواد الخدمات: كود يُكتب يدويًا بلا نمط يجعل الحفظ مستحيلًا على
--      الاستقبال. تُضاف دالّة تُعطي أصغر كود رقميّ حرّ من رقمين أو ثلاثة،
--      وتُرقَّم الخدمات القائمة التي لا كود قصير لها — مع حفظ الكود القديم
--      في `legacy_code` فلا يُفقد مرجعٌ خارجيّ.
--
-- تُنفَّذ مرّتين بلا أثر مختلف (idempotent).
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) اللوائح المرجعية — زرع تكميليّ عامّ (organization_id is null)
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * زرع قيم لائحة مرجعية عامة بلا إتلاف.
 *
 * `p_values` مصفوفة كائنات: {"ar": "...", "en": "...", "sort": 10}
 *
 *  - تُنشأ الفئة العامة إن غابت (لا تُنشأ فئة لمنشأة: القوائم النظامية عامة).
 *  - القيمة تُضاف إن غاب اسمها العربي عن الفئة، وتُستكمل تسميتها الإنجليزية
 *    وترتيبها إن كانت ناقصة — ولا يُغيَّر `is_disabled` أبدًا: تعطيل قيمة
 *    قرارُ مسؤول المنشأة، وإعادة تفعيلها من ترقية قاعدة نقضٌ لقراره.
 */
create or replace function app_seed_global_lookup(
  p_key text,
  p_name_ar text,
  p_name_en text,
  p_values jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_category uuid;
  v_added integer := 0;
  v_row jsonb;
begin
  -- `unique (organization_id, key)` لا يمنع تكرار الفئة العامة (NULL مميّز عن
  -- NULL في Postgres)، فالقراءة بـ`limit 1` لا بـ`into` عارية — وإلّا فشلت
  -- الترقية بخطأ «أكثر من صف» على قاعدة زُرعت مرّتين.
  select id into v_category
    from lookup_categories
   where key = p_key and organization_id is null
   order by id
   limit 1;

  if v_category is null then
    insert into lookup_categories (organization_id, key, name_ar, name_en)
    values (null, p_key, p_name_ar, p_name_en)
    returning id into v_category;
  end if;

  for v_row in select * from jsonb_array_elements(p_values)
  loop
    if not exists (
      select 1 from lookup_values
       where category_id = v_category
         and btrim(name_ar) = btrim(v_row ->> 'ar')
    ) then
      insert into lookup_values (category_id, name_ar, name_en, sort_order)
      values (v_category, btrim(v_row ->> 'ar'), nullif(btrim(coalesce(v_row ->> 'en', '')), ''),
              coalesce((v_row ->> 'sort')::int, 500));
      v_added := v_added + 1;
    else
      update lookup_values
         set name_en = coalesce(nullif(btrim(name_en), ''), nullif(btrim(coalesce(v_row ->> 'en', '')), '')),
             sort_order = coalesce((v_row ->> 'sort')::int, sort_order)
       where category_id = v_category
         and btrim(name_ar) = btrim(v_row ->> 'ar');
    end if;
  end loop;

  return v_added;
end;
$$;
revoke all on function app_seed_global_lookup(text, text, text, jsonb) from public, anon, authenticated;

do $$
declare
  v_added integer;
begin
  -- الجنسيات: دول الخليج أوّلًا، ثم العربية، ثم الجنسيات الأكثر حضورًا في
  -- منشآت المملكة. «سعودي» أوّل القائمة لأنها الأشيع إدخالًا.
  v_added := app_seed_global_lookup('nationalities', 'الجنسيات', 'Nationalities', '[
    {"ar":"سعودي","en":"Saudi","sort":10},
    {"ar":"إماراتي","en":"Emirati","sort":20},
    {"ar":"كويتي","en":"Kuwaiti","sort":30},
    {"ar":"قطري","en":"Qatari","sort":40},
    {"ar":"بحريني","en":"Bahraini","sort":50},
    {"ar":"عُماني","en":"Omani","sort":60},
    {"ar":"يمني","en":"Yemeni","sort":70},
    {"ar":"مصري","en":"Egyptian","sort":80},
    {"ar":"سوداني","en":"Sudanese","sort":90},
    {"ar":"سوري","en":"Syrian","sort":100},
    {"ar":"أردني","en":"Jordanian","sort":110},
    {"ar":"فلسطيني","en":"Palestinian","sort":120},
    {"ar":"لبناني","en":"Lebanese","sort":130},
    {"ar":"عراقي","en":"Iraqi","sort":140},
    {"ar":"ليبي","en":"Libyan","sort":150},
    {"ar":"تونسي","en":"Tunisian","sort":160},
    {"ar":"جزائري","en":"Algerian","sort":170},
    {"ar":"مغربي","en":"Moroccan","sort":180},
    {"ar":"موريتاني","en":"Mauritanian","sort":190},
    {"ar":"صومالي","en":"Somali","sort":200},
    {"ar":"جيبوتي","en":"Djiboutian","sort":210},
    {"ar":"جزر القمر","en":"Comorian","sort":220},
    {"ar":"إريتري","en":"Eritrean","sort":230},
    {"ar":"إثيوبي","en":"Ethiopian","sort":240},
    {"ar":"تشادي","en":"Chadian","sort":250},
    {"ar":"نيجيري","en":"Nigerian","sort":260},
    {"ar":"غاني","en":"Ghanaian","sort":270},
    {"ar":"كيني","en":"Kenyan","sort":280},
    {"ar":"أوغندي","en":"Ugandan","sort":290},
    {"ar":"هندي","en":"Indian","sort":300},
    {"ar":"باكستاني","en":"Pakistani","sort":310},
    {"ar":"بنغلاديشي","en":"Bangladeshi","sort":320},
    {"ar":"سريلانكي","en":"Sri Lankan","sort":330},
    {"ar":"نيبالي","en":"Nepalese","sort":340},
    {"ar":"فلبيني","en":"Filipino","sort":350},
    {"ar":"إندونيسي","en":"Indonesian","sort":360},
    {"ar":"ماليزي","en":"Malaysian","sort":370},
    {"ar":"أفغاني","en":"Afghan","sort":380},
    {"ar":"إيراني","en":"Iranian","sort":390},
    {"ar":"تركي","en":"Turkish","sort":400},
    {"ar":"أذربيجاني","en":"Azerbaijani","sort":410},
    {"ar":"أوزبكي","en":"Uzbek","sort":420},
    {"ar":"كازاخي","en":"Kazakh","sort":430},
    {"ar":"صيني","en":"Chinese","sort":440},
    {"ar":"ياباني","en":"Japanese","sort":450},
    {"ar":"كوري","en":"Korean","sort":460},
    {"ar":"فيتنامي","en":"Vietnamese","sort":470},
    {"ar":"تايلاندي","en":"Thai","sort":480},
    {"ar":"ميانماري","en":"Burmese","sort":490},
    {"ar":"بريطاني","en":"British","sort":500},
    {"ar":"أمريكي","en":"American","sort":510},
    {"ar":"كندي","en":"Canadian","sort":520},
    {"ar":"أسترالي","en":"Australian","sort":530},
    {"ar":"فرنسي","en":"French","sort":540},
    {"ar":"ألماني","en":"German","sort":550},
    {"ar":"إيطالي","en":"Italian","sort":560},
    {"ar":"إسباني","en":"Spanish","sort":570},
    {"ar":"هولندي","en":"Dutch","sort":580},
    {"ar":"روسي","en":"Russian","sort":590},
    {"ar":"أوكراني","en":"Ukrainian","sort":600},
    {"ar":"بولندي","en":"Polish","sort":610},
    {"ar":"روماني","en":"Romanian","sort":620},
    {"ar":"برازيلي","en":"Brazilian","sort":630},
    {"ar":"جنوب أفريقي","en":"South African","sort":640},
    {"ar":"بدون","en":"Stateless","sort":900},
    {"ar":"أخرى","en":"Other","sort":999}
  ]'::jsonb);
  raise notice '0146: أضيفت % جنسية ناقصة', v_added;

  -- المدن: مدن المملكة الرئيسية — مرشّح المدينة في شاشة المرضى يقارن
  -- `city_value_id`، وقائمة فارغة تجعله مرشّحًا لا يُرجع نتيجة أبدًا.
  v_added := app_seed_global_lookup('cities', 'المدن', 'Cities', '[
    {"ar":"الرياض","en":"Riyadh","sort":10},
    {"ar":"جدة","en":"Jeddah","sort":20},
    {"ar":"مكة المكرمة","en":"Makkah","sort":30},
    {"ar":"المدينة المنورة","en":"Madinah","sort":40},
    {"ar":"الدمام","en":"Dammam","sort":50},
    {"ar":"الخبر","en":"Khobar","sort":60},
    {"ar":"الظهران","en":"Dhahran","sort":70},
    {"ar":"الأحساء","en":"Al Ahsa","sort":80},
    {"ar":"القطيف","en":"Qatif","sort":90},
    {"ar":"الجبيل","en":"Jubail","sort":100},
    {"ar":"الطائف","en":"Taif","sort":110},
    {"ar":"بريدة","en":"Buraidah","sort":120},
    {"ar":"عنيزة","en":"Unaizah","sort":130},
    {"ar":"حائل","en":"Hail","sort":140},
    {"ar":"تبوك","en":"Tabuk","sort":150},
    {"ar":"أبها","en":"Abha","sort":160},
    {"ar":"خميس مشيط","en":"Khamis Mushait","sort":170},
    {"ar":"جيزان","en":"Jazan","sort":180},
    {"ar":"نجران","en":"Najran","sort":190},
    {"ar":"الباحة","en":"Al Bahah","sort":200},
    {"ar":"عرعر","en":"Arar","sort":210},
    {"ar":"سكاكا","en":"Sakaka","sort":220},
    {"ar":"القريات","en":"Qurayyat","sort":230},
    {"ar":"ينبع","en":"Yanbu","sort":240},
    {"ar":"رابغ","en":"Rabigh","sort":250},
    {"ar":"الخرج","en":"Al Kharj","sort":260},
    {"ar":"المجمعة","en":"Al Majmaah","sort":270},
    {"ar":"الزلفي","en":"Zulfi","sort":280},
    {"ar":"وادي الدواسر","en":"Wadi Al Dawasir","sort":290},
    {"ar":"بيشة","en":"Bisha","sort":300},
    {"ar":"القنفذة","en":"Al Qunfudhah","sort":310},
    {"ar":"صبيا","en":"Sabya","sort":320},
    {"ar":"الرس","en":"Ar Rass","sort":330},
    {"ar":"شرورة","en":"Sharurah","sort":340},
    {"ar":"حفر الباطن","en":"Hafar Al Batin","sort":350},
    {"ar":"الدوادمي","en":"Dawadmi","sort":360},
    {"ar":"أخرى","en":"Other","sort":999}
  ]'::jsonb);
  raise notice '0146: أضيفت % مدينة ناقصة', v_added;

  -- جهات العمل: تصنيف عامّ يكفي للتقارير (القطاع لا اسم الشركة).
  v_added := app_seed_global_lookup('work_entities', 'جهات العمل', 'Work Entities', '[
    {"ar":"قطاع حكومي","en":"Government","sort":10},
    {"ar":"قطاع عسكري","en":"Military","sort":20},
    {"ar":"قطاع صحي","en":"Healthcare","sort":30},
    {"ar":"قطاع تعليمي","en":"Education","sort":40},
    {"ar":"قطاع خاص","en":"Private Sector","sort":50},
    {"ar":"أعمال حرة","en":"Self Employed","sort":60},
    {"ar":"طالب","en":"Student","sort":70},
    {"ar":"متقاعد","en":"Retired","sort":80},
    {"ar":"غير عامل","en":"Unemployed","sort":90},
    {"ar":"ربة منزل","en":"Homemaker","sort":100},
    {"ar":"أخرى","en":"Other","sort":999}
  ]'::jsonb);
  raise notice '0146: أضيفت % جهة عمل ناقصة', v_added;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) العمر المُدخَل: علَم يميّز تاريخ الميلاد التقديريّ
-- ═══════════════════════════════════════════════════════════════════════════

alter table patients
  add column if not exists birth_date_is_estimated boolean not null default false;

comment on column patients.birth_date_is_estimated is
  'تاريخ الميلاد مشتقّ من عمرٍ أدخله الاستقبال لا من وثيقة هوية — يُقرأ العمر منه صحيحًا ولا يُعتمد اليوم والشهر.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) رقم الهوية فريد لكل منشأة
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * أعمدة الدمج — تُضاف هنا إن غابت.
 *
 * أضافها 0066 أصلًا، لكنّ قاعدةً لم تُنفَّذ عليها تلك الترقية تُفشل كل ما
 * يأتي بعدها هنا برسالة «العمود غير موجود» فتتراجع الترقية كاملةً. وقاعدة
 * التفرّد نفسها تحتاجها: الملفّ المدموج بقيّة تاريخية لا ملفّ حيّ، فلا يجوز
 * أن يحجز رقم هوية.
 *
 * التعريفات هنا **نسخة حرفية** من 0066 فلا تختلف قاعدتان في شيء. وإضافتها
 * لا تُكمل ميزة الدمج: تلك تحتاج بقيّة 0066 (حارس الحجز على ملفّ مدموج
 * ودالّة الدمج) — فإن أضافت هذه الترقية الأعمدة فعلًا، فذلك دليلٌ على أن
 * 0066 لم يُنفَّذ، وعليك تنفيذه.
 */
alter table patients
  add column if not exists merged_into_id uuid references patients(id) on delete set null,
  add column if not exists merged_at      timestamptz,
  add column if not exists merged_by      uuid references auth.users(id),
  add column if not exists merge_reason   text;

create index if not exists idx_patients_merged
  on patients (merged_into_id) where merged_into_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'app_merge_patients'
  ) then
    raise notice '0146: تنبيه — دالّة دمج الملفّات غائبة، أي أن 0066 لم يُنفَّذ على هذه القاعدة. زرّ «دمج الملفّات» في الواجهة لن يعمل حتى تنفّذه.';
  end if;
end $$;

/**
 * منع ملفَّين بنفس رقم الهوية في المنشأة.
 *
 * يُستثنى: الرقم الفارغ (المولود الجديد لا هوية له بعد)، والملف المدموج
 * (`merged_into_id is not null` — بقيّة تاريخية لا ملفٌ حيّ).
 *
 * المُحفِّز لا الفهرس وحده: الفهرس يفشل إنشاؤه على قاعدة فيها تكرار قائم،
 * والمُحفِّز يعمل فورًا ويُعطي رسالة تقول **أين** الملف الآخر — فيذهب
 * الموظف إليه بدل أن يفتح ملفًا ثانيًا.
 */
create or replace function app_guard_patient_id_number_unique()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := nullif(btrim(coalesce(new.id_number, '')), '');
  v_other record;
begin
  if v_id is null or new.merged_into_id is not null then
    return new;
  end if;

  select p.file_number, p.name_ar into v_other
    from patients p
   where p.organization_id = new.organization_id
     and p.id <> new.id
     and p.merged_into_id is null
     and nullif(btrim(coalesce(p.id_number, '')), '') = v_id
   limit 1;

  if v_other.file_number is not null then
    raise exception 'رقم الهوية % مسجَّل في الملف رقم % (%). لكل مريض ملف واحد — افتح الملف القائم بدل فتح ملف ثانٍ.',
      v_id, v_other.file_number, v_other.name_ar;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_patient_id_number_unique on patients;
create trigger trg_guard_patient_id_number_unique
  before insert or update of id_number, organization_id, merged_into_id on patients
  for each row execute function app_guard_patient_id_number_unique();

/**
 * التكرار القائم قبل هذا المنع — يُعرَض ليُدمَج يدويًا بأداة الدمج.
 *
 * لا يُحذف ولا يُدمَج تلقائيًا: الدمج ينقل تاريخًا طبيًا وماليًا، وقرار
 * «هذان الملفان لشخص واحد» قرار بشريّ لا تخمين ترقية.
 */
create or replace view v_duplicate_patient_id_numbers as
select p.organization_id,
       nullif(btrim(p.id_number), '') as id_number,
       count(*)                        as files_count,
       array_agg(p.file_number order by p.file_number) as file_numbers,
       array_agg(p.name_ar order by p.file_number)     as names,
       array_agg(p.id order by p.file_number)          as patient_ids
  from patients p
 where nullif(btrim(coalesce(p.id_number, '')), '') is not null
   and p.merged_into_id is null
 group by p.organization_id, nullif(btrim(p.id_number), '')
having count(*) > 1;

-- بلا `security_invoker` يقرأ المنظور بصلاحية مالكه فيتجاوز RLS ويكشف مرضى
-- منشآت أخرى لكل مستخدم مُوثَّق.
alter view v_duplicate_patient_id_numbers set (security_invoker = on);
grant select on v_duplicate_patient_id_numbers to authenticated;

-- الفهرس الفريد لا يُنشأ إلّا على قاعدة نظيفة: `create unique index` على
-- قاعدة فيها تكرار يُفشل الترقية كلها، ولا يجوز أن تتوقّف ترقية بسبب بيانات
-- تحتاج قرارًا بشريًا. المُحفِّز أعلاه يمنع الجديد في كل الحالات.
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes from v_duplicate_patient_id_numbers;
  if v_dupes = 0 then
    create unique index if not exists patients_org_id_number_uniq
      on patients (organization_id, btrim(id_number))
      where nullif(btrim(coalesce(id_number, '')), '') is not null
        and merged_into_id is null;
    raise notice '0146: أُنشئ الفهرس الفريد لرقم الهوية';
  else
    raise notice '0146: يوجد % رقم هوية مكرَّر — راجع v_duplicate_patient_id_numbers وادمج الملفات، ثم أعد تنفيذ هذه الترقية لإنشاء الفهرس', v_dupes;
  end if;
end $$;

/**
 * فحص رقم الهوية من الواجهة قبل الحفظ — ليقرأ الموظف «الملف موجود» وهو
 * يكتب، لا بعد أن يملأ ثلاثين حقلًا ويضغط الحفظ.
 *
 * `security definer` مع حارس عضوية: الاستعلام المباشر من المتصفّح يخضع
 * لـRLS ويكفي، لكن الدالّة تُعيد رقم الملف واسمه في نداء واحد وتضمن أن
 * الفحص هو **نفس** ما سيفحصه المُحفِّز (التطبيع بـ`btrim` نفسه).
 */
create or replace function app_patient_by_id_number(
  p_organization_id uuid,
  p_id_number text,
  p_exclude_patient_id uuid default null
)
returns table (patient_id uuid, name_ar text, file_number bigint, is_merged boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := nullif(btrim(coalesce(p_id_number, '')), '');
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if v_id is null then
    return;
  end if;

  return query
  select p.id, p.name_ar, p.file_number, p.merged_into_id is not null
    from patients p
   where p.organization_id = p_organization_id
     and nullif(btrim(coalesce(p.id_number, '')), '') = v_id
     and (p_exclude_patient_id is null or p.id <> p_exclude_patient_id)
   order by p.merged_into_id nulls first, p.file_number
   limit 5;
end;
$$;
revoke all on function app_patient_by_id_number(uuid, text, uuid) from public, anon;
grant execute on function app_patient_by_id_number(uuid, text, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) أكواد خدمات قصيرة (رقمان أو ثلاثة)
-- ═══════════════════════════════════════════════════════════════════════════

alter table items
  add column if not exists legacy_code text;

comment on column items.legacy_code is
  'الكود قبل الترقيم القصير — يُحفظ ليبقى المرجع الخارجي القديم قابلًا للبحث.';

/**
 * أصغر كود رقميّ حرّ من رقمين أو ثلاثة (10..999) في المنشأة.
 *
 * الفحص يشمل **كل** الأصناف لا الخدمات وحدها: قيد التفرّد
 * `unique (organization_id, code)` لا يفرّق بين خدمة ومنتج، فكودٌ يُعطى
 * لخدمة وهو مستعمل لمنتج يُفشل الحفظ.
 *
 * تُعيد null حين تنتهي الأرقام القصيرة (أكثر من ٩٩٠ صنفًا): الاستدعاء
 * يتراجع إلى الكود اليدويّ بدل أن يُعطي كودًا مكرَّرًا.
 */
create or replace function app_next_short_item_code(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code integer;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;

  select n into v_code
    from generate_series(10, 999) as n
   where not exists (
     select 1 from items i
      where i.organization_id = p_organization_id
        and btrim(i.code) = n::text
   )
   order by n
   limit 1;

  return v_code::text;
end;
$$;
revoke all on function app_next_short_item_code(uuid) from public, anon;
grant execute on function app_next_short_item_code(uuid) to authenticated;

/**
 * ترقيم الخدمات القائمة بأكواد قصيرة.
 *
 *  - الخدمات فقط (`item_type = 'service'`): المنتجات والأدوية لها باركود
 *    ومرجع مورّد، وتغيير كودها يقطع مطابقة أوامر الشراء.
 *  - الخدمة التي كودها أصلًا من رقمين أو ثلاثة تُترك كما هي.
 *  - الكود القديم يُحفظ في `legacy_code` مرّة واحدة (لا يُطمَس بترقيم ثانٍ).
 *  - المؤرشفة تُترك: كودها لا يظهر في أي قائمة اختيار، وتغييره عبثٌ يُلوّث
 *    سجل التدقيق.
 *  - الترتيب بالاسم لا بتاريخ الإنشاء: قائمة الخدمات تُعرض بالاسم، فترقيمٌ
 *    يوازيه يجعل الحفظ ممكنًا فعلًا.
 */
create or replace function app_renumber_service_codes(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item record;
  v_code text;
  v_count integer := 0;
begin
  -- إعادة ترقيم أكواد كل خدمات المنشأة تغييرٌ جماعيّ يراه كل موظف في كل شاشة
  -- بحث — فلا يكفي فيه أن يكون المستدعي عضوًا.
  if not app_is_org_admin(p_organization_id) then
    raise exception 'إعادة ترقيم الأكواد تتطلّب صلاحية مسؤول المنشأة';
  end if;

  for v_item in
    select i.id, i.code
      from items i
     where i.organization_id = p_organization_id
       and i.item_type = 'service'
       and not i.is_archived
       and btrim(i.code) !~ '^[0-9]{2,3}$'
     order by i.name_ar, i.id
  loop
    select n::text into v_code
      from generate_series(10, 999) as n
     where not exists (
       select 1 from items x
        where x.organization_id = p_organization_id
          and btrim(x.code) = n::text
     )
     order by n
     limit 1;

    -- انتهت الأرقام القصيرة: تُترك بقيّة الخدمات بأكوادها بلا خطأ
    exit when v_code is null;

    update items
       set code = v_code,
           legacy_code = coalesce(legacy_code, v_item.code)
     where id = v_item.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function app_renumber_service_codes(uuid) from public, anon;
grant execute on function app_renumber_service_codes(uuid) to authenticated;

-- ترقيم أوّليّ لكل منشأة قائمة. الدالّة تفرض العضوية، والترقية تُنفَّذ بلا
-- جلسة مستخدم — فيُنفَّذ المنطق هنا مباشرةً بنفس القواعد.
do $$
declare
  v_org record;
  v_item record;
  v_code text;
  v_total integer := 0;
begin
  for v_org in select id from organizations loop
    for v_item in
      select i.id, i.code
        from items i
       where i.organization_id = v_org.id
         and i.item_type = 'service'
         and not i.is_archived
         and btrim(i.code) !~ '^[0-9]{2,3}$'
       order by i.name_ar, i.id
    loop
      select n::text into v_code
        from generate_series(10, 999) as n
       where not exists (
         select 1 from items x
          where x.organization_id = v_org.id
            and btrim(x.code) = n::text
       )
       order by n
       limit 1;
      exit when v_code is null;

      update items
         set code = v_code,
             legacy_code = coalesce(legacy_code, v_item.code)
       where id = v_item.id;
      v_total := v_total + 1;
    end loop;
  end loop;
  raise notice '0146: أُعطيت % خدمة كودًا قصيرًا', v_total;
end $$;
