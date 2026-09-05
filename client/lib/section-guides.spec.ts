import { describe, expect, it } from "vitest";
import { moduleRegistry, settingsModule } from "./module-registry";
import {
  SECTION_GUIDE_KEYS,
  guideKeyForPath,
  hasSectionGuide,
  type SectionGuide,
} from "./section-guides";
import { sectionGuides } from "./section-guides-data";

/** ملفّ المريض شاشة بلا عنصر في القائمة الجانبية، فيُضاف يدويًّا. */
const EXTRA_SCREEN_KEYS = ["patient-profile"];

const expectedKeys = [
  ...moduleRegistry.map((item) => item.id),
  settingsModule.id,
  ...EXTRA_SCREEN_KEYS,
];

function allText(guide: SectionGuide): string {
  return [
    guide.title,
    guide.purpose,
    ...(guide.concepts ?? []).flatMap((item) => [item.term, item.meaning]),
    ...(guide.flow ?? []),
    ...(guide.actions ?? []).flatMap((item) => [item.label, item.effect]),
    ...(guide.links ?? []),
    ...(guide.cautions ?? []),
  ].join(" \n ");
}

describe("أدلّة الأقسام", () => {
  it("لكل شاشة في النظام دليل مكتوب", () => {
    // هذا هو الاختبار الذي يمنع الحالة التي بُني هذا القسم لعلاجها: شاشة
    // جديدة تُضاف إلى القائمة فتظهر للمستخدم بلا أي شرح. إضافة موديول دون
    // دليله تُسقط هذا الاختبار قبل أن يصل إلى المستخدم.
    const missing = expectedKeys.filter((key) => !sectionGuides[key]);
    expect(missing).toEqual([]);
  });

  it("لا دليل زائد لا تقابله شاشة", () => {
    const extra = Object.keys(sectionGuides).filter((key) => !expectedKeys.includes(key));
    expect(extra).toEqual([]);
  });

  it("قائمة المفاتيح الخفيفة مطابقة لنصوص الأدلّة", () => {
    // الزرّ يقرّر ظهوره من قائمة المفاتيح وحدها (حتى لا يحمّل النصوص كلّها)،
    // فاختلافها عن النصوص يعني زرًّا يفتح لوحًا فارغًا أو شرحًا لا يُفتح.
    expect([...SECTION_GUIDE_KEYS].sort()).toEqual(Object.keys(sectionGuides).sort());
  });

  it("كل دليل مكتمل: عنوان وغرض وأزرار وارتباطات", () => {
    Object.entries(sectionGuides).forEach(([key, guide]) => {
      expect(guide.title.trim().length, key).toBeGreaterThan(2);
      expect(guide.purpose.trim().length, key).toBeGreaterThan(40);
      expect(guide.actions?.length ?? 0, key).toBeGreaterThanOrEqual(2);
      expect(guide.links?.length ?? 0, key).toBeGreaterThanOrEqual(1);
      (guide.actions ?? []).forEach((action) => {
        expect(action.label.trim().length, `${key}/${action.label}`).toBeGreaterThan(1);
        expect(action.effect.trim().length, `${key}/${action.label}`).toBeGreaterThan(20);
      });
      (guide.concepts ?? []).forEach((concept) => {
        expect(concept.meaning.trim().length, `${key}/${concept.term}`).toBeGreaterThan(20);
      });
    });
  });

  it("لا مصطلحات تقنية ولا أسماء داخلية في نصّ الأدلّة", () => {
    // الشرط المطلوب صراحةً: الدليل يشرح المفهوم لا البناء. أي تسريب لمصطلح
    // قاعدة بيانات أو اسم داخلي يعني أن الدليل كُتب لمطوّر لا لموظّف.
    const banned =
      /(supabase|postgres|\bsql\b|\brpc\b|\brls\b|\bjson\b|\bapi\b|\btoken\b|\bschema\b|\bquery\b|\bmigration\b|_id\b|[a-z]+_[a-z]+)/i;
    const offenders: string[] = [];
    Object.entries(sectionGuides).forEach(([key, guide]) => {
      const match = allText(guide).match(banned);
      if (match) offenders.push(`${key}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });

  it("يستخرج الدليل الصحيح من المسار", () => {
    expect(guideKeyForPath("/")).toBe("dashboard");
    expect(guideKeyForPath("")).toBe("dashboard");
    expect(guideKeyForPath("/services")).toBe("services");
    expect(guideKeyForPath("/services/")).toBe("services");
    expect(guideKeyForPath("/services?q=1")).toBe("services");
    expect(guideKeyForPath("/patients")).toBe("patients");
    expect(guideKeyForPath("/patients/8f2c")).toBe("patient-profile");
    expect(hasSectionGuide(guideKeyForPath("/patients/8f2c"))).toBe(true);
    expect(hasSectionGuide(guideKeyForPath("/route-does-not-exist"))).toBe(false);
    expect(hasSectionGuide(null)).toBe(false);
  });
});
