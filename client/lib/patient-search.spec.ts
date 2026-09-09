import { describe, expect, it } from "vitest";

import {
  buildPatientSearchOr,
  digitsOnly,
  matchesPatientSearch,
  patientSearchPlaceholder,
  PATIENTS_SEARCH_COLUMNS,
  toLatinDigits,
} from "./patient-search";

const patient = {
  name_ar: "أحمد بن سالم",
  name_en: "Ahmed Salem",
  mobile_number: "0551234567",
  phone_1: "0112223333",
  phone_2: null,
  id_number: "1098765432",
  file_number: 4021,
};

describe("تطبيع الأرقام", () => {
  it("يحوّل الأرقام العربية-الهندية إلى لاتينية", () => {
    expect(toLatinDigits("٠٥٥١٢٣٤٥٦٧")).toBe("0551234567");
    expect(toLatinDigits("۰۵۵")).toBe("055");
  });

  it("يتخطّى المسافات والشرطات وبادئة الدولة", () => {
    expect(digitsOnly("+966 55-123 4567")).toBe("966551234567");
  });
});

describe("المطابقة المحلّية", () => {
  it("تجد بالاسم العربي والإنجليزي", () => {
    expect(matchesPatientSearch(patient, "سالم", [])).toBe(true);
    expect(matchesPatientSearch(patient, "ahmed", [])).toBe(true);
  });

  it("تجد بالجوال ولو كُتب بأرقام عربية أو بمسافات", () => {
    expect(matchesPatientSearch(patient, "٠٥٥١٢٣٤٥٦٧", [])).toBe(true);
    expect(matchesPatientSearch(patient, "055 123 4567", [])).toBe(true);
  });

  it("تجد بالهوية", () => {
    expect(matchesPatientSearch(patient, "1098765432", [])).toBe(true);
  });

  it("تجد برقم الملفّ مطابقةً تامّة في البحث الشامل وحده", () => {
    expect(matchesPatientSearch(patient, "4021", [])).toBe(true);
    // محصورًا بالجوال لا يُطابق رقم الملفّ
    expect(matchesPatientSearch(patient, "4021", ["mobile"])).toBe(false);
  });

  it("الحصر يستبعد ما عداه", () => {
    expect(matchesPatientSearch(patient, "1098765432", ["mobile"])).toBe(false);
    expect(matchesPatientSearch(patient, "1098765432", ["id"])).toBe(true);
    expect(matchesPatientSearch(patient, "سالم", ["mobile", "id"])).toBe(false);
    expect(matchesPatientSearch(patient, "سالم", ["name", "id"])).toBe(true);
  });

  it("نصّ فارغ يُبقي كل الصفوف", () => {
    expect(matchesPatientSearch(patient, "   ", [])).toBe(true);
  });
});

describe("مرشّح PostgREST", () => {
  it("يشمل الثلاثة حين لا حصر", () => {
    const filter = buildPatientSearchOr("055", [], PATIENTS_SEARCH_COLUMNS) ?? "";
    expect(filter).toContain("name_ar.ilike.%055%");
    expect(filter).toContain("mobile_number.ilike.%055%");
    expect(filter).toContain("id_number.ilike.%055%");
  });

  it("يقتصر على الجوال حين يُحصَر به", () => {
    const filter = buildPatientSearchOr("055", ["mobile"], PATIENTS_SEARCH_COLUMNS) ?? "";
    expect(filter).toContain("mobile_number.ilike.%055%");
    expect(filter).not.toContain("name_ar");
    expect(filter).not.toContain("id_number");
  });

  it("رقم الملفّ في البحث الشامل وحده وبمطابقة تامّة", () => {
    expect(buildPatientSearchOr("4021", [], PATIENTS_SEARCH_COLUMNS)).toContain("file_number.eq.4021");
    expect(buildPatientSearchOr("4021", ["name"], PATIENTS_SEARCH_COLUMNS)).not.toContain("file_number");
  });

  /**
   * الفاصلة والقوس يفصلان شروط `or()` في PostgREST — اسمٌ فيه أحدهما كان
   * يُنتج مرشّحًا مكسورًا يردّه الخادم بـ400، والشاشة تعرض «لا نتائج».
   */
  it("ينظّف المحارف التي تكسر or()", () => {
    const filter = buildPatientSearchOr("عبدالله, (أبو خالد)", [], PATIENTS_SEARCH_COLUMNS) ?? "";
    const namePart = filter.split(",").find((part) => part.startsWith("name_ar")) ?? "";
    expect(namePart).not.toContain("(");
    expect(namePart).not.toContain(")");
  });

  it("نصّ فارغ لا يُنتج مرشّحًا", () => {
    expect(buildPatientSearchOr("   ", [], PATIENTS_SEARCH_COLUMNS)).toBeNull();
  });
});

describe("النصّ الإرشادي", () => {
  it("يتبع النطاق المختار فلا يَعِد بما لا يبحث فيه", () => {
    expect(patientSearchPlaceholder([])).toContain("الاسم");
    expect(patientSearchPlaceholder(["mobile"])).toBe("بحث بـالجوال");
  });
});
