import { test as base, expect, type Page } from "@playwright/test";

/**
 * أدوات مشتركة للاختبارات.
 *
 * **معرّف تشغيل فريد لكل جولة.** كل مريض يُنشأ باسم يحمل هذا المعرّف، فلا
 * تختلط بيانات جولتين ولا تُحذف جولةٌ بياناتِ أخرى تعمل بالتوازي. وهو أيضًا
 * ما يجعل التنظيف ممكنًا: يُبحث عنه فيُعرف ما أنشأته هذه الجولة بالضبط.
 */
export const RUN_ID = process.env.E2E_RUN_ID ?? `E2E${Date.now().toString(36).toUpperCase()}`;

type Role = "receptionist" | "doctor" | "accountant" | "manager";

const CREDENTIALS: Record<Role, { email: string | undefined; password: string | undefined }> = {
  receptionist: { email: process.env.E2E_RECEPTION_EMAIL, password: process.env.E2E_RECEPTION_PASSWORD },
  doctor:       { email: process.env.E2E_DOCTOR_EMAIL,    password: process.env.E2E_DOCTOR_PASSWORD },
  accountant:   { email: process.env.E2E_ACCOUNTANT_EMAIL, password: process.env.E2E_ACCOUNTANT_PASSWORD },
  manager:      { email: process.env.E2E_MANAGER_EMAIL,   password: process.env.E2E_MANAGER_PASSWORD },
};

export async function signIn(page: Page, role: Role) {
  const creds = CREDENTIALS[role];
  if (!creds.email || !creds.password) {
    throw new Error(
      `بيانات الدخول للدور «${role}» غير مضبوطة. اضبط E2E_${role.toUpperCase()}_EMAIL و_PASSWORD في ملف .env`,
    );
  }
  await page.goto("/");
  // الشاشة قد تكون مسجَّلة الدخول أصلًا من حالة محفوظة
  const loginEntry = page.getByRole("button", { name: /تسجيل الدخول|إنشاء منشأة/ });
  if (await loginEntry.isVisible().catch(() => false)) {
    await loginEntry.click();
  }
  await page.getByLabel(/البريد|Email/i).fill(creds.email);
  await page.getByLabel(/كلمة المرور|Password/i).fill(creds.password);
  await page.getByRole("button", { name: /دخول|تسجيل/ }).click();
  await expect(page.getByRole("navigation").or(page.getByText(/الاستقبال|المواعيد/))).toBeVisible({
    timeout: 30_000,
  });
}

export async function signOut(page: Page) {
  // الخروج عبر مسح التخزين لا عبر الواجهة: زرّ الخروج قد يتغيّر موضعه،
  // والاختبار لا يجب أن يفشل لسبب لا علاقة له بما يقيسه.
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* متصفح يمنع التخزين — لا يهم هنا */
    }
  });
}

/** اسم مريض هذه الجولة — يحمل المعرّف الفريد ليمكن العثور عليه وحذفه. */
export function patientName(suffix = "") {
  return `مريض اختبار ${RUN_ID}${suffix ? ` ${suffix}` : ""}`;
}

/** رقم جوال فريد لكل جولة، لتفادي تحذير التكرار في الحالات التي لا تختبره. */
export function mobileNumber(seed = 0) {
  const digits = String(Math.abs(hash(RUN_ID) + seed) % 10_000_000).padStart(7, "0");
  return `05${digits}`;
}

function hash(text: string) {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) | 0;
  return value;
}

export const test = base.extend<{ runId: string }>({
  runId: async ({}, use) => {
    await use(RUN_ID);
  },
});

export { expect };
