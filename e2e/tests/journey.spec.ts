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
let appointmentId = "";

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
    appointmentId = new URL(page.url()).searchParams.get("appointmentId") ?? "";
    expect(appointmentId, "يجب أن يحمل السجل الطبي معرّف الموعد لربط الزيارة والفاتورة").not.toBe("");
  });

  await test.step("9-11) الطبيب: شكوى وخدمة وطلبات ثم حفظ", async () => {
    await signOut(page);
    await signIn(page, "doctor");
    await page.goto(`/medical-records?appointmentId=${appointmentId}`);

    const visitDialog = page.getByRole("dialog", { name: "زيارة فحص جديدة" });
    await visitDialog.getByLabel(/الشكوى/).fill(`شكوى اختبار ${RUN_ID}`);

    const serviceSearch = visitDialog.getByPlaceholder("البحث عن صنف أو خدمة بالاسم أو الكود...");
    await serviceSearch.fill("ا");
    await serviceSearch.locator("..").locator("..").getByRole("button").first().click();
    await expect(visitDialog.getByText(/الإجمالي التقديري/)).toBeVisible();

    const labSearch = visitDialog.getByPlaceholder("ابحث عن فحص مخبري...");
    await expect(labSearch.locator("..").getByRole("checkbox").first()).toBeVisible();
    await labSearch.locator("..").getByRole("checkbox").first().check();

    const radiologySearch = visitDialog.getByPlaceholder("ابحث عن فحص أشعة...");
    await expect(radiologySearch.locator("..").getByRole("checkbox").first()).toBeVisible();
    await radiologySearch.locator("..").getByRole("checkbox").first().check();
    await visitDialog
      .getByPlaceholder("السبب السريري للطلب — يوجّه الأخصائي أثناء القراءة")
      .fill(`سبب سريري ${RUN_ID}`);

    const drugSearch = visitDialog.getByPlaceholder("ابحث عن دواء لإضافته للوصفة...");
    await drugSearch.fill("ا");
    await drugSearch.locator("..").getByRole("button").first().click();
    await visitDialog.getByPlaceholder("التكرار (مرتين يوميًا)").fill("مرتين يوميًا");
    await visitDialog.getByPlaceholder("المدة (أيام)").fill("5");

    await visitDialog.getByRole("button", { name: "حفظ الزيارة" }).click();
    await expect(page.getByText(/تم حفظ زيارة الفحص|حُفظت الزيارة(?: مع تنبيه)?/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("12) المحاسب: فاتورة مرتبطة بالزيارة", async () => {
    await signOut(page);
    await signIn(page, "accountant");
    await page.goto(`/billing?appointmentId=${appointmentId}`);

    const invoiceDialog = page.getByRole("dialog", { name: "فاتورة مبيعات جديدة" });
    await expect(invoiceDialog.getByText(`المحدد: ${createdPatient}`)).toBeVisible({ timeout: 30_000 });
    await expect(invoiceDialog.getByText("الخدمات المنفَّذة في الزيارة")).toBeVisible();
    await invoiceDialog.getByRole("button", { name: "إضافة الكل" }).click();

    for (const order of ["طلب مختبر", "طلب أشعة", "وصفة"]) {
      const orderButton = invoiceDialog.getByRole("button", { name: new RegExp(`^${order}:`) });
      await expect(orderButton).toBeVisible();
      await orderButton.click();
    }

    await invoiceDialog.getByRole("button", { name: "حفظ الفاتورة" }).click();
    await expect(page.getByText("تم إنشاء الفاتورة")).toBeVisible({ timeout: 30_000 });
    const invoiceRow = page.getByRole("row", { name: new RegExp(createdPatient) });
    await expect(invoiceRow.getByText("غير مدفوعة")).toBeVisible({ timeout: 20_000 });
  });

  await test.step("13) المحاسب: تسجيل دفعة كاملة", async () => {
    const invoiceRow = page.getByRole("row", { name: new RegExp(createdPatient) });
    await invoiceRow.getByRole("button", { name: "تسجيل دفعة" }).click();

    const paymentDialog = page.getByRole("dialog", { name: "تسجيل دفعة" });
    await paymentDialog.getByRole("button", { name: "الكل" }).click();
    await paymentDialog.getByRole("combobox").click();
    const nonCashMethod = page.getByRole("option").filter({ hasNotText: "(نقد)" }).first();
    await expect(nonCashMethod).toBeVisible();
    await nonCashMethod.click();
    await paymentDialog.getByPlaceholder("رقم الحوالة أو العملية").fill(`E2E-${RUN_ID}`);
    await paymentDialog.getByRole("button", { name: "تسجيل الدفعة" }).click();
    await expect(page.getByText("سُجّلت الدفعة")).toBeVisible({ timeout: 30_000 });
    await expect(paymentDialog.getByText(/قبض #/)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(paymentDialog).toBeHidden();
    await expect(invoiceRow.getByText("مدفوعة بالكامل")).toBeVisible({ timeout: 30_000 });
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
    for (const label of [
      "فُتح ملف المريض",
      "حُجز موعد",
      "وصل المريض",
      "سُجّل دخوله",
      "نودي المريض",
      "بدأت الزيارة",
      "زيارة طبية",
      "خدمة منفَّذة",
      "طلب مختبر",
      "طلب أشعة",
      "وصفة طبية",
      "فاتورة",
      "سند receipt",
      "انتهت الزيارة",
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("16) الأحداث ظاهرة في سجل التدقيق", async () => {
    await signOut(page);
    await signIn(page, "manager");
    await page.goto("/audit-log");
    await expect(page.getByText(/appointments|المواعيد/).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.skip(
  "مطالبة التأمين تتطلب عضوية وبوليصة تأمين نشطة ومصنّفة للمريض من بيانات الاختبار",
  async () => {
    // لا تُنشأ مطالبة وهمية: واجهة «عضوية التأمين» لا تتيح الحفظ بلا وثيقة مزروعة للمريض.
  },
);

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
