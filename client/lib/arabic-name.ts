/**
 * نقل الاسم العربي إلى حروف لاتينية، وحساب العمر — لملف المريض.
 *
 * **لماذا في القاعدة لا يُفعل هذا؟** لأن النقل الحرفيّ اجتهاد لا حقيقة:
 * «محمد» تُكتب Mohammed وMuhammad وMohamed، والمنشأة قد تُفضّل صيغة على
 * أخرى. فالنتيجة تُقترح في الحقل الإنجليزي **قابلةً للتعديل**، ولا تُفرض
 * ولا تُكتب فوق ما كتبه الموظف بيده.
 *
 * والمعجم يسبق القاعدة الحرفية: نقل «عبدالله» حرفًا بحرف يُعطي Abdallh،
 * والاسم كما يُكتب في الجوازات Abdullah. فالأسماء الشائعة تُنقَل بمعجمها،
 * وما ليس فيه يُنقَل بقاعدة حرفية معقولة.
 */

/** تشكيل وتطويل ومحارف اتجاه — تُزال قبل أي معالجة. */
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ​-‏]/g;

/** توحيد صور الحروف التي تُكتب بأشكال مختلفة لنفس الصوت. */
function normalizeArabic(input: string): string {
  return input
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * معجم الأسماء الشائعة — بالصيغة التي تُكتب بها في الوثائق الرسمية.
 * المفاتيح بعد التطبيع (بلا همزات ولا تشكيل).
 */
const NAME_DICTIONARY: Record<string, string> = {
  // أسماء الرجال الأشيع
  محمد: "Mohammed",
  احمد: "Ahmed",
  علي: "Ali",
  حسن: "Hassan",
  حسين: "Hussain",
  عبدالله: "Abdullah",
  عبدالرحمن: "Abdulrahman",
  عبدالعزيز: "Abdulaziz",
  عبدالرحيم: "Abdulrahim",
  عبدالكريم: "Abdulkarim",
  عبدالمجيد: "Abdulmajeed",
  عبدالحميد: "Abdulhameed",
  عبدالمحسن: "Abdulmohsen",
  عبدالسلام: "Abdulsalam",
  عبدالوهاب: "Abdulwahab",
  عبدالملك: "Abdulmalik",
  عبدالاله: "Abdulilah",
  عبدالهادي: "Abdulhadi",
  عبدالناصر: "Abdulnasser",
  عبدالفتاح: "Abdulfattah",
  عبدالجبار: "Abduljabbar",
  عبدالقادر: "Abdulqader",
  عبدالغني: "Abdulghani",
  عبدالحكيم: "Abdulhakeem",
  عبدالمنعم: "Abdulmonem",
  عبدالمعطي: "Abdulmuti",
  عبدالستار: "Abdulsattar",
  عبدالخالق: "Abdulkhaliq",
  عبدالباري: "Abdulbari",
  عبدالرزاق: "Abdulrazzaq",
  عبدالرب: "Abdulrab",
  عبد: "Abdul",
  عمر: "Omar",
  عثمان: "Othman",
  خالد: "Khalid",
  سعد: "Saad",
  سعود: "Saud",
  سعيد: "Saeed",
  سلمان: "Salman",
  سليمان: "Sulaiman",
  فهد: "Fahad",
  فيصل: "Faisal",
  تركي: "Turki",
  بندر: "Bandar",
  نايف: "Naif",
  ماجد: "Majed",
  مشعل: "Mishal",
  متعب: "Mutaib",
  منصور: "Mansour",
  ناصر: "Nasser",
  نواف: "Nawaf",
  بدر: "Badr",
  راشد: "Rashed",
  ريان: "Rayan",
  زياد: "Ziyad",
  طلال: "Talal",
  عادل: "Adel",
  عامر: "Amer",
  عايض: "Ayed",
  عبير: "Abeer",
  عزام: "Azzam",
  عصام: "Essam",
  عقيل: "Aqeel",
  عمار: "Ammar",
  عوض: "Awad",
  غازي: "Ghazi",
  فارس: "Fares",
  فواز: "Fawaz",
  كمال: "Kamal",
  لؤي: "Louay",
  مازن: "Mazen",
  محسن: "Mohsen",
  محمود: "Mahmoud",
  مروان: "Marwan",
  مصطفى: "Mustafa",
  معاذ: "Muath",
  ممدوح: "Mamdouh",
  مهند: "Muhannad",
  موسى: "Musa",
  ياسر: "Yasser",
  يوسف: "Yousef",
  يعقوب: "Yaqoub",
  ابراهيم: "Ibrahim",
  اسماعيل: "Ismail",
  اسامه: "Osama",
  انور: "Anwar",
  ايمن: "Ayman",
  اياد: "Iyad",
  اكرم: "Akram",
  امجد: "Amjad",
  اشرف: "Ashraf",
  اسعد: "Asaad",
  اوس: "Aws",
  بشير: "Basheer",
  بلال: "Bilal",
  ثامر: "Thamer",
  جابر: "Jaber",
  جاسم: "Jassim",
  جمال: "Jamal",
  حاتم: "Hatem",
  حامد: "Hamed",
  حمد: "Hamad",
  حمزه: "Hamzah",
  حماد: "Hammad",
  حيدر: "Haidar",
  خليل: "Khalil",
  رائد: "Raed",
  رامي: "Rami",
  رضا: "Reda",
  رياض: "Riyadh",
  سالم: "Salem",
  سامي: "Sami",
  سامر: "Samer",
  سراج: "Siraj",
  سلطان: "Sultan",
  سهيل: "Suhail",
  شاكر: "Shaker",
  صالح: "Saleh",
  صابر: "Saber",
  صقر: "Saqr",
  ضياء: "Diaa",
  طارق: "Tariq",
  طاهر: "Taher",
  ظافر: "Zafer",
  عبيد: "Obaid",
  عدنان: "Adnan",
  عرفان: "Irfan",
  فؤاد: "Fouad",
  فادي: "Fadi",
  فتحي: "Fathi",
  قاسم: "Qasem",
  كريم: "Kareem",
  لطفي: "Lutfi",
  مالك: "Malek",
  مبارك: "Mubarak",
  مجدي: "Majdi",
  مدثر: "Mudathir",
  مراد: "Murad",
  مشاري: "Mishari",
  مصعب: "Musab",
  معتز: "Muataz",
  منير: "Muneer",
  مهدي: "Mahdi",
  نبيل: "Nabeel",
  نادر: "Nader",
  نجيب: "Najeeb",
  نزار: "Nizar",
  هاني: "Hani",
  هاشم: "Hashem",
  هشام: "Hisham",
  وائل: "Wael",
  وليد: "Waleed",
  وسام: "Wisam",
  يحيى: "Yahya",
  يزيد: "Yazeed",
  زيد: "Zaid",
  زهير: "Zuhair",

  // أسماء النساء الأشيع
  فاطمه: "Fatimah",
  عائشه: "Aishah",
  خديجه: "Khadijah",
  مريم: "Maryam",
  نوره: "Norah",
  نور: "Noor",
  ساره: "Sarah",
  هيا: "Haya",
  هند: "Hind",
  منى: "Muna",
  ريم: "Reem",
  لمى: "Lama",
  لينا: "Lina",
  دانه: "Dana",
  جواهر: "Jawaher",
  الجوهره: "Aljawharah",
  العنود: "Alanoud",
  منيره: "Muneerah",
  لطيفه: "Latifah",
  موضي: "Moudi",
  شيخه: "Shaikhah",
  حصه: "Hissah",
  سلمى: "Salma",
  اسماء: "Asma",
  امل: "Amal",
  املاك: "Amlak",
  ابرار: "Abrar",
  اروى: "Arwa",
  اسيل: "Aseel",
  افنان: "Afnan",
  اميره: "Amirah",
  انفال: "Anfal",
  ايمان: "Eman",
  بشائر: "Bashaer",
  تهاني: "Tahani",
  جميله: "Jameelah",
  حنان: "Hanan",
  حياه: "Hayat",
  دلال: "Dalal",
  رانيا: "Rania",
  رحمه: "Rahmah",
  رغد: "Raghad",
  روان: "Rawan",
  ريما: "Rima",
  زينب: "Zainab",
  سميه: "Sumayyah",
  سميره: "Sameerah",
  سهام: "Siham",
  شذى: "Shatha",
  شهد: "Shahad",
  صفيه: "Safiyyah",
  عبله: "Ablah",
  عفاف: "Afaf",
  غاده: "Ghadah",
  فوزيه: "Fawziyyah",
  لبنى: "Lubna",
  ليلى: "Layla",
  مروه: "Marwah",
  مشاعل: "Mashael",
  نجود: "Nujood",
  نجلاء: "Najla",
  ندى: "Nada",
  نوف: "Nouf",
  هبه: "Hebah",
  هدى: "Huda",
  هناء: "Hanaa",
  وجدان: "Wijdan",
  وعد: "Waad",
  يسرى: "Yusra",

  /**
   * أسماء العائلات الأشيع — بمقدّمة «ال» كما تُكتب.
   *
   * وجودها في المعجم ليس تزيّدًا: القاعدة الحرفية لا تستطيع استرجاع الحركات
   * القصيرة التي لا تُكتب في العربية، فـ«الشهري» تُنقَل ح‍رفًا بحرف إلى
   * Alshhri — وهو ليس ما في هوية المريض. وأسماء العائلات في المملكة مجموعة
   * محدودة، فمعجمها يغطّي معظم الملفات فعلًا.
   */
  الشهري: "Alshehri",
  القحطاني: "Alqahtani",
  الغامدي: "Alghamdi",
  الزهراني: "Alzahrani",
  العتيبي: "Alotaibi",
  الحربي: "Alharbi",
  المطيري: "Almutairi",
  الدوسري: "Aldosari",
  العنزي: "Alanazi",
  الشمري: "Alshammari",
  السبيعي: "Alsubaie",
  البقمي: "Albaqami",
  العسيري: "Alasiri",
  الخالدي: "Alkhalidi",
  الجهني: "Aljuhani",
  الصاعدي: "Alsaedi",
  اليامي: "Alyami",
  الرشيدي: "Alrashidi",
  السهلي: "Alsuhaimi",
  الفيفي: "Alfaifi",
  الاحمدي: "Alahmadi",
  البلوي: "Albalawi",
  العمري: "Alamri",
  المالكي: "Almalki",
  الشريف: "Alsharif",
  السلمي: "Alsalmi",
  اللحياني: "Allehyani",
  الثبيتي: "Althubaiti",
  الحازمي: "Alhazmi",
  الشيباني: "Alshaibani",
  العوفي: "Alaoufi",
  المحمدي: "Almohammadi",
  الجابري: "Aljabri",
  النفيعي: "Alnufaie",
  الحمياني: "Alhumayani",
  الروقي: "Alrouqi",
  العطوي: "Alatawi",
  الحويطي: "Alhuwaiti",
  الشلوي: "Alshalawi",
  الفهيد: "Alfuhaid",
  السويلم: "Alsuwailem",
  الشثري: "Alshathri",
  القصير: "Alqusair",
  العريفي: "Alarifi",
  الحصان: "Alhassan",
  الدخيل: "Aldakhil",
  الدريهم: "Aldraiheem",
  الجاسر: "Aljasser",
  الخريجي: "Alkhuraiji",
  العجلان: "Alajlan",
  الراجحي: "Alrajhi",
  السعدون: "Alsaadoun",
  الشبانه: "Alshabanah",
  الطويل: "Altuwail",
  العامر: "Alamer",
  الفراج: "Alfarraj",
  القاضي: "Alqadi",
  المانع: "Almanea",
  الناصر: "Alnasser",
  الهاجري: "Alhajri",
  الوهيبي: "Alwuhaibi",
  اليوسف: "Alyousef",
  المصري: "Almasri",
  الشامي: "Alshami",
  اليمني: "Alyamani",
  السوداني: "Alsudani",
  الحلبي: "Alhalabi",
  الدمشقي: "Aldamashqi",
  البغدادي: "Albaghdadi",
  المقدسي: "Almaqdisi",
  الخطيب: "Alkhateeb",
  الحداد: "Alhaddad",
  النجار: "Alnajjar",
  الصباغ: "Alsabbagh",
  الحاج: "Alhaj",
  العلي: "Alali",
  الحسن: "Alhassan",
  الحسيني: "Alhussaini",
  الموسوي: "Almousawi",
  العبدالله: "Alabdullah",
  الرشيد: "Alrasheed",
  السعود: "Alsaud",
  الشعيبي: "Alshuaibi",
  الوادعي: "Alwadei",
  العقيلي: "Alaqeeli",
  الشهراني: "Alshahrani",
  الحكمي: "Alhakami",
  المولد: "Almawlid",
  الطلحي: "Altalhi",
  الرفاعي: "Alrifai",
  الزبيدي: "Alzubaidi",

  // كلمات تركيب الأسماء
  بن: "Bin",
  ابن: "Bin",
  بنت: "Bint",
  ابو: "Abu",
  ابا: "Aba",
  ام: "Um",
  ال: "Al",
  الدين: "Aldeen",
  دين: "Deen",
  الله: "Allah",
};

const LETTERS: Record<string, string> = {
  ا: "a", ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh", د: "d", ذ: "dh",
  ر: "r", ز: "z", س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z", ع: "a",
  غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", و: "w",
  ي: "y", ة: "ah", ء: "",
};

/** نقل كلمة واحدة حرفًا بحرف حين لا تكون في المعجم. */
function transliterateWord(word: string): string {
  let out = "";
  for (let index = 0; index < word.length; index += 1) {
    const char = word[index];
    const isFirst = index === 0;
    const isLast = index === word.length - 1;

    if (char === "و") {
      // «و» في أول الكلمة صوت W، وفي وسطها حرف علّة (محمود: Mahmoud)
      out += isFirst ? "w" : "ou";
      continue;
    }
    if (char === "ي") {
      out += isFirst ? "y" : isLast ? "i" : "ee";
      continue;
    }
    if (char === "ة") {
      out += "ah";
      continue;
    }
    out += LETTERS[char] ?? "";
  }
  // «aa» و«ii» المتوالية من تطبيع الهمزات تُختصر
  return out.replace(/a{2,}/g, "a").replace(/e{3,}/g, "ee");
}

function capitalize(word: string): string {
  if (!word) return word;
  return word[0].toUpperCase() + word.slice(1);
}

/**
 * مفتاح البحث في المعجم: التاء المربوطة تُوحَّد هاءً.
 *
 * بلا هذا التوحيد تفلت «فاطمة» من المعجم لأن مفتاحه «فاطمه» — فتُنقَل حرفًا
 * بحرف إلى Fatmah بدل Fatimah، وهي أشيع اسم في القوائم.
 */
function dictionaryLookup(word: string): string | undefined {
  return NAME_DICTIONARY[word] ?? NAME_DICTIONARY[word.replace(/ة/g, "ه")];
}

/** نقل كلمة مع مراعاة «ال» التعريف والمعجم. */
function renderWord(rawWord: string): string {
  const word = rawWord.replace(/[^ء-ي]/g, "");
  if (!word) return "";

  const dictionary = dictionaryLookup(word);
  if (dictionary) return dictionary;

  // «ال» التعريف: تُكتب Al موصولةً بالاسم كما تُصدَر في الهويات والجوازات
  // (الشهري ← Alshehri لا Ash-Shehri) — الصيغة الصوتية أدقّ لغويًا وأسوأ
  // عمليًا: لا تُطابق ما هو مكتوب في وثيقة المريض. وحرف ما بعد «ال» يبقى
  // صغيرًا: Alharbi لا AlHarbi.
  if (word.length > 3 && word.startsWith("ال")) {
    const rest = word.slice(2);
    const restName = dictionaryLookup(rest) ?? transliterateWord(rest);
    return `Al${restName.charAt(0).toLowerCase()}${restName.slice(1)}`;
  }

  // «عبد» الملتصقة بما بعدها ولم يُطابقها المعجم (عبدالمعبود مثلًا)
  if (word.startsWith("عبدال") && word.length > 5) {
    const rest = word.slice(5);
    const restName = dictionaryLookup(rest) ?? capitalize(transliterateWord(rest));
    return `Abdul${restName.charAt(0).toLowerCase()}${restName.slice(1)}`;
  }

  return capitalize(transliterateWord(word));
}

/**
 * الاسم العربي بحروف لاتينية.
 *
 * «عبد» المنفصلة تُدمَج مع ما بعدها (عبد الله ← Abdullah) لأن الهوية تكتبها
 * كلمةً واحدة، وتقسيمها يجعل الاسم الرباعي خمس كلمات في الإنجليزي.
 */
export function transliterateArabicName(input: string | null | undefined): string {
  const normalized = normalizeArabic(input ?? "");
  if (!normalized) return "";

  const words = normalized.split(" ").filter(Boolean);
  const merged: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if ((word === "عبد" || word === "ابو" || word === "ام") && index + 1 < words.length) {
      merged.push(word === "عبد" ? word + words[index + 1] : `${word} ${words[index + 1]}`);
      index += 1;
      continue;
    }
    merged.push(word);
  }

  return merged
    .map((word) => (word.includes(" ") ? word.split(" ").map(renderWord).join(" ") : renderWord(word)))
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** عدد مقاطع الاسم — «الاسم الرباعي» يعني أربعة مقاطع أو أكثر. */
export function nameWordCount(input: string | null | undefined): number {
  return normalizeArabic(input ?? "")
    .split(" ")
    .filter((word) => word.replace(/[^ء-ي\w]/g, "").length > 0).length;
}

/** العمر بالسنوات من تاريخ الميلاد — بحساب اليوم والشهر لا بطرح السنوات. */
export function ageFromBirthDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const birth = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

/** عدد الأشهر بعد السنوات الكاملة — للرضّع والأطفال دون السنتين. */
export function ageMonthsFromBirthDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const birth = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
  if (today.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return null;
  return months % 12;
}

/**
 * تاريخ ميلاد تقديريّ من عمرٍ مُدخَل (YYYY-MM-DD).
 *
 * يُحسَب طرحًا من **تاريخ اليوم** لا من أول السنة: هكذا يعود العمر المعروض
 * غدًا هو نفس العمر الذي أدخله الموظف، ولا يقفز بسنة عند رأس السنة. ويُوسَم
 * في القاعدة `birth_date_is_estimated` فلا يُقرأ يومه وشهره كأنهما موثَّقان.
 */
export function birthDateFromAge(years: string | number, months: string | number = 0): string | null {
  const y = Number(years);
  const m = Number(months) || 0;
  if (!Number.isFinite(y) || y < 0 || y > 130) return null;
  if (!Number.isFinite(m) || m < 0 || m > 11) return null;
  if (y === 0 && m === 0) return null;

  const today = new Date();
  /**
   * اليوم يُقصَر على طول الشهر الهدف قبل بناء التاريخ.
   *
   * `new Date(y, 1, 31)` يفيض إلى ٣ مارس، فعمرٌ أُدخل «٦ أشهر» في ٣١ أغسطس
   * كان سيعود ٥ أشهر — والموظف يرى رقمًا غير الذي كتبه.
   */
  const targetMonthIndex = today.getMonth() - m;
  const monthAnchor = new Date(today.getFullYear() - y, targetMonthIndex, 1);
  const daysInMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
  const date = new Date(
    monthAnchor.getFullYear(),
    monthAnchor.getMonth(),
    Math.min(today.getDate(), daysInMonth),
  );
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
