import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * إعداد اختبارات الرحلة الكاملة.
 *
 * **لا تُشغَّل على بيانات الإنتاج.** `E2E_BASE_URL` يجب أن يشير إلى نسخة
 * اختبار، و`E2E_*_EMAIL` إلى حسابات في **منشأة اختبار مخصَّصة**. الاختبارات
 * تُنشئ مرضى ومواعيد وفواتير حقيقية — وهي بيانات لا مكان لها بين بيانات
 * مرضى فعليين، ولا يجوز أن تُرسل لهم رسائل تذكير.
 *
 * `workers: 1` مقصود: الاختبارات تتشارك طابور استقبال واحد وأرقام دور
 * متسلسلة، والتوازي يجعل النتائج غير قابلة لإعادة الإنتاج — وهو أسوأ ما
 * يصيب مجموعة اختبارات: فشلٌ لا يتكرّر لا يُصلَح.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // الجوال مطلوب في شروط القبول: شاشة الاستقبال تُستعمل على جهاز لوحي
      // في كثير من العيادات، والأعمدة الأحد عشر يجب أن تظل قابلة للتمرير لا
      // أن تنكسر.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /journey\.spec\.ts/,
    },
  ],
});
