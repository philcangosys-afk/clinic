import { describe, expect, it } from "vitest";
import {
  ageFromBirthDate,
  ageMonthsFromBirthDate,
  birthDateFromAge,
  nameWordCount,
  transliterateArabicName,
} from "./arabic-name";

describe("transliterateArabicName", () => {
  it("ينقل الأسماء الشائعة بصيغتها الرسمية لا حرفًا بحرف", () => {
    expect(transliterateArabicName("محمد عبدالله أحمد الشهري")).toBe(
      "Mohammed Abdullah Ahmed Alshehri",
    );
    expect(transliterateArabicName("فاطمة صالح محمد العتيبي")).toBe(
      "Fatimah Saleh Mohammed Alotaibi",
    );
  });

  it("يدمج «عبد» المنفصلة مع ما بعدها كما في الهوية", () => {
    expect(transliterateArabicName("عبد الله")).toBe("Abdullah");
    expect(transliterateArabicName("عبد العزيز")).toBe("Abdulaziz");
  });

  it("يتجاهل التشكيل والتطويل والمسافات الزائدة", () => {
    expect(transliterateArabicName("مُحَمَّد   أحمد")).toBe("Mohammed Ahmed");
  });

  it("يوحّد التاء المربوطة فتُطابق المعجم", () => {
    expect(transliterateArabicName("نورة")).toBe("Norah");
    expect(transliterateArabicName("نوره")).toBe("Norah");
  });

  it("يكتب «ال» موصولةً بحرف صغير كما في الجوازات", () => {
    expect(transliterateArabicName("الحربي")).toBe("Alharbi");
    expect(transliterateArabicName("القحطاني")).toBe("Alqahtani");
  });

  it("ينقل ما ليس في المعجم بقاعدة حرفية لا يعيده فارغًا", () => {
    const out = transliterateArabicName("مبروك سنيتان");
    expect(out.length).toBeGreaterThan(4);
    expect(out).toMatch(/^[A-Za-z' -]+$/);
  });

  it("يعيد نصًّا فارغًا للمدخل الفارغ ولا يرمي", () => {
    expect(transliterateArabicName("")).toBe("");
    expect(transliterateArabicName(null)).toBe("");
    expect(transliterateArabicName(undefined)).toBe("");
  });

  it("لا يُخرج حروفًا عربية في النتيجة", () => {
    expect(transliterateArabicName("عبدالرحمن بن ناصر الدوسري")).not.toMatch(/[ء-ي]/);
  });
});

describe("nameWordCount", () => {
  it("يعدّ مقاطع الاسم للتحقّق من الاسم الرباعي", () => {
    expect(nameWordCount("محمد عبدالله أحمد الشهري")).toBe(4);
    expect(nameWordCount("محمد أحمد")).toBe(2);
    expect(nameWordCount("   محمد    أحمد   ")).toBe(2);
    expect(nameWordCount("")).toBe(0);
  });
});

describe("العمر وتاريخ الميلاد", () => {
  it("العمر المُدخَل يعود كما هو بعد التحويل إلى تاريخ", () => {
    for (const age of [0, 1, 7, 30, 65, 99]) {
      const date = birthDateFromAge(age, age === 0 ? 6 : 0);
      if (age === 0) {
        expect(ageFromBirthDate(date)).toBe(0);
        expect(ageMonthsFromBirthDate(date)).toBe(6);
      } else {
        expect(ageFromBirthDate(date)).toBe(age);
      }
    }
  });

  it("يرفض العمر المستحيل بدل أن يكتب تاريخًا خاطئًا", () => {
    expect(birthDateFromAge(-1)).toBeNull();
    expect(birthDateFromAge(200)).toBeNull();
    expect(birthDateFromAge(1, 13)).toBeNull();
    expect(birthDateFromAge("")).toBeNull();
    expect(birthDateFromAge(0, 0)).toBeNull();
  });

  it("العمر من تاريخ الميلاد يحسب اليوم والشهر لا السنة وحدها", () => {
    const today = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const tomorrow = new Date(today.getFullYear() - 20, today.getMonth(), today.getDate() + 1);
    const iso = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
    // ميلادٌ غدًا قبل عشرين سنة يعني العمر ١٩ اليوم لا ٢٠
    expect(ageFromBirthDate(iso)).toBe(19);
  });

  it("لا يرمي على مدخل فاسد", () => {
    expect(ageFromBirthDate("غير تاريخ")).toBeNull();
    expect(ageFromBirthDate(null)).toBeNull();
    expect(ageMonthsFromBirthDate("")).toBeNull();
  });
});
