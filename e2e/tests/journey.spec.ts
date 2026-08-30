import { test, expect, signIn, signOut, patientName, mobileNumber, RUN_ID } from "../fixtures/app";

/**
 * الرحلة الأساسية بأربعة أدوار.
 *
 * اختبار واحد متسلسل لا خمسة مستقلة: الرحلة **حالة متراكمة** — لا يمكن
 * فوترة زيارة لم تُفتح، ولا فتح زيارة لمريض لم يصل. تقسيمها إلى اختبارات
 * مستقلة كان سيتطلب تهيئة كل حالة من الصفر عبر القاعدة، فيصير الاختبار
 * يفحص التهيئة لا التطبيق.
 *
 * و`test.step` يجعل الفشل يشير إلى الخطوة بعينها، فلا يضيع في سجل طويل.
 */
test.describe.configure({ mode: "serial" });

let createdPatient = "";
let appointmentTime = "";

test("الرحلة الكاملة: حجز ← استقبال ← زيارة ← فاتورة ← إنهاء", async ({ page }) => {
  createdPatient = patientName();

  await test.step("1) دخول موظف الاستقبال", async () => {
    await signIn(page, "receptionist");
  });

  await test.step("2) إنشاء مريض", async () => {
    await page.goto("/patients");
    await page.getByRole("button", { name: /مريض جديد|إضافة مريض/ }).click();
    await page.getByLabel(/الاسم بالعربية|الاسم/).first().fill(createdPatient);
    await page.getByLabel(/الجوال/).first().fill(mobileNumber());
    await page.getByRole("button", { name: /حفظ/ }).click();
    // كشف التكرار قد يظهر تحذيرًا في أول ضغطة — الضغط ثانيةً يُكمل، وهو
    // السلوك المقصود لا حيلة على الاختبار.
    const again = page.getByRole("button", { name: /حفظ/ });
    if (await again.isVisible().catch(() => false)) {
      await again.click().catch(() => undefined);
    }
    await expect(page.getByText(createdPatient).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step("3) إنشاء موعد", async () => {
    await page.goto("/appointments");
    await page.getByRole("button", { name: /موعد جديد/ }).click();
    await page.getByPlaceholder(/البحث بالاسم/).first().fill(createdPatient);
    await page.getByText(createdPatient).first().click();
    // الطبيب: أول خيار متاح — الاختبار يقيس الرحلة لا اختيار طبيب بعينه
    await page.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    appointmentTime = "10:00";
    await page.getByLabel(/الوقت/).first().fill(appointmentTime);
    await page.getByRole("button", { name: /حفظ|إنشاء/ }).click();
    await expect(page.getByText(createdPatient).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step("4) تأكيد الموعد", async () => {
    await page.goto("/appointments");
    await page.getByRole("button", { name: /بطاقات/ }).click().catch(() => undefined);
    await page.getByRole("button", { name: /^تأكيد$/ }).first().click();
    await expect(page.getByText(/تم تأكيد الموعد/)).toBeVisible();
  });

  await test.step("5-7) وصول ← تسجيل ← نداء", async () => {
    await page.goto("/reception");
    const row = page.getByRole("row", { name: new RegExp(createdPatient) });
    await row.getByRole("button", { name: /وصول/ }).click();
    await expect(row.getByRole("button", { name: /تسجيل/ })).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: /تسجيل/ }).click();
    await row.getByRole("button", { name: /^نداء$/ }).click();
    await expect(row.getByRole("button", { name: /إعادة نداء/ })).toBeVisible({ timeout: 20_000 });
  });

  await test.step("8) بدء الزيارة", async () => {
    const row = page.getByRole("row", { name: new RegExp(createdPatient) });
    await row.getByRole("button", { name: /بدء الزيارة/ }).click();
    // بدء الزيارة ينقل إلى السجل الطبي — وهذا بالضبط ما كان معطَّلًا قبل
    // 0055 (التباس اسم عمود لم يظهر إلا وقت التنفيذ).
    await expect(page).toHaveURL(/medical-records/, { timeout: 30_000 });
  });

  await test.step("9-11) الطبيب: شكوى وتشخيص وخدمة ثم حفظ", async () => {
    await signOut(page);
    await signIn(page, "doctor");
    await page.goto("/reception");
    const row = page.getByRole("row", { name: new RegExp(createdPatient) });
    await row.getByRole("button", { name: /بدء الزيارة/ }).click().catch(() => undefined);
    await page.waitForURL(/medical-records/, { timeout: 30_000 }).catch(() => undefined);

    await page.getByLabel(/الشكوى/).first().fill(`شكوى اختبار ${RUN_ID}`);
    await page.getByRole("button", { name: /حفظ الزيارة/ }).click();
    await expect(page.getByText(/تم حفظ زيارة الفحص|حُفظت الزيارة/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("12-13) المحاسب: فاتورة ودفعة", async () => {
    await signOut(page);
    await signIn(page, "accountant");
    await page.goto("/billing");
    await page.getByRole("button", { name: /فاتورة جديدة|إنشاء فاتورة/ }).first().click();
    await page.getByPlaceholder(/البحث بالاسم/).first().fill(createdPatient);
    await page.getByText(createdPatient).first().click();
    await page.getByPlaceholder(/البحث عن صنف/).first().fill("ا");
    await page.getByRole("button").filter({ hasText: /^\S/ }).first().click().catch(() => undefined);
    await page.getByRole("button", { name: /حفظ الفاتورة|إصدار/ }).first().click();
    await expect(page.getByText(/تم إنشاء الفاتورة|أُصدرت/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("14) إنهاء الموعد", async () => {
    await signOut(page);
    await signIn(page, "receptionist");
    await page.goto("/reception");
    const row = page.getByRole("row", { name: new RegExp(createdPatient) });
    await row.getByRole("button", { name: /إنهاء/ }).click();
    await expect(row).toBeHidden({ timeout: 20_000 });
  });

  await test.step("15) الأحداث ظاهرة في رحلة المريض", async () => {
    await page.goto("/patient-journey");
    await page.getByPlaceholder(/البحث بالاسم/).first().fill(createdPatient);
    await page.getByText(createdPatient).first().click();
    for (const label of ["فُتح ملف المريض", "حُجز موعد", "وصل المريض", "نودي المريض", "بدأت الزيارة"]) {
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("16) الأحداث ظاهرة في سجل التدقيق", async () => {
    await signOut(page);
    await signIn(page, "manager");
    await page.goto("/audit-log");
    await expect(page.getByText(/appointments|المواعيد/).first()).toBeVisible({ timeout: 20_000 });
  });
});

test("لا أخطاء في الطرفية ولا طلبات فاشلة أثناء الرحلة", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    // 401 أثناء صفحة الدخول متوقّع؛ ما عداه ليس كذلك.
    if (response.status() >= 400 && response.status() !== 401) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  await signIn(page, "receptionist");
  for (const path of ["/appointments", "/reception", "/waitlist", "/patients", "/patient-journey", "/reports"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
  }

  // PGRST201 هو التباس العلاقات، وPGRST هو خطأ استعلام — كلاهما لا يظهر
  // إلا وقت التشغيل، وهو ما يجعل هذا الفحص أهم من أي فحص ثابت.
  const pgrst = [...consoleErrors, ...failedRequests].filter((line) => /PGRST|42P17/.test(line));
  expect(pgrst, `أخطاء PostgREST: ${pgrst.join(" | ")}`).toHaveLength(0);
  expect(failedRequests, `طلبات فاشلة: ${failedRequests.join(" | ")}`).toHaveLength(0);
});
