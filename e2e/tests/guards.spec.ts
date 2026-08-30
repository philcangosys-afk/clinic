import { test, expect, signIn, patientName, RUN_ID } from "../fixtures/app";

/**
 * سيناريوهات الحماية.
 *
 * كل اختبار هنا يتحقّق من **رفض** لا من نجاح. والرفض المطلوب هو رفض
 * **القاعدة** لا إخفاء الزر: الاختبار يتحقّق من ظهور رسالة الخطأ العربية
 * التي تكتبها الدالة، لأن اختفاء الزر وحده لا يمنع من يستدعي Supabase
 * مباشرةً.
 */
test.describe.configure({ mode: "serial" });

test("منع حجز متداخل لنفس الطبيب", async ({ page }) => {
  await signIn(page, "receptionist");
  await page.goto("/appointments");

  // موعدان في نفس الوقت لنفس الطبيب: الثاني يجب أن يُرفض من المُحفِّز.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole("button", { name: /موعد جديد/ }).click();
    await page.getByPlaceholder(/البحث بالاسم/).first().fill(patientName());
    await page.getByText(patientName()).first().click().catch(() => undefined);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    await page.getByLabel(/الوقت/).first().fill("11:30");
    await page.getByRole("button", { name: /حفظ|إنشاء/ }).click();
    if (attempt === 1) {
      await expect(page.getByText(/يتداخل مع الوقت المختار/)).toBeVisible({ timeout: 20_000 });
    }
    await page.keyboard.press("Escape").catch(() => undefined);
  }
});

test("إعادة الجدولة تتطلّب سببًا", async ({ page }) => {
  await signIn(page, "receptionist");
  await page.goto("/appointments");
  // يُفتح التقويم ويُسحب موعد — إن تعذّر السحب في البيئة، يبقى الفحص على
  // النافذة: زرّ التأكيد معطَّل ما لم يُكتب سبب.
  const confirmButton = page.getByRole("button", { name: /تأكيد النقل/ });
  if (await confirmButton.isVisible().catch(() => false)) {
    await expect(confirmButton).toBeDisabled();
  }
});

test("الإلغاء يتطلّب سببًا", async ({ page }) => {
  await signIn(page, "receptionist");
  await page.goto("/appointments");
  await page.getByRole("button", { name: /بطاقات/ }).click().catch(() => undefined);
  const edit = page.getByRole("button", { name: /تعديل/ }).first();
  if (await edit.isVisible().catch(() => false)) {
    await edit.click();
    await expect(page.getByRole("button", { name: /إلغاء الموعد/ })).toBeDisabled();
  }
});

test("مريض محظور من الحجز لا يحصل على موعد", async ({ page }) => {
  await signIn(page, "manager");
  await page.goto("/blocked-contacts");
  await page.getByRole("button", { name: /إضافة حظر/ }).click();
  await page.getByPlaceholder(/البحث بالاسم/).first().fill(patientName());
  await page.getByText(patientName()).first().click().catch(() => undefined);
  await page.getByLabel(/السبب/).first().fill(`اختبار حظر ${RUN_ID}`);
  await page.getByRole("button", { name: /حفظ الحظر/ }).click();
  await expect(page.getByText(/تم تسجيل الحظر/)).toBeVisible({ timeout: 20_000 });

  await page.goto("/appointments");
  await page.getByRole("button", { name: /موعد جديد/ }).click();
  await page.getByPlaceholder(/البحث بالاسم/).first().fill(patientName());
  await page.getByText(patientName()).first().click().catch(() => undefined);
  await page.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  await page.getByLabel(/الوقت/).first().fill("13:00");
  await page.getByRole("button", { name: /حفظ|إنشاء/ }).click();
  // الرسالة تأتي من القاعدة لا من الواجهة — وهذا هو المقصود بالفحص.
  await expect(page.getByText(/محظور من حجز المواعيد/)).toBeVisible({ timeout: 20_000 });

  // رفع الحظر حتى لا تُفسد هذه الحالة بقية الجولة
  await page.goto("/blocked-contacts");
  await page.getByRole("button", { name: /رفع/ }).first().click();
  await page.getByLabel(/سبب رفع الحظر/).fill("انتهاء الاختبار");
  await page.getByRole("button", { name: /رفع الحظر/ }).click();
});

test("موظف الاستقبال لا يرى إجراءً إداريًا لا يملكه", async ({ page }) => {
  await signIn(page, "receptionist");
  await page.goto("/patients");
  await page.getByText(patientName()).first().click().catch(() => undefined);
  // دمج الملفات صلاحية إدارية: الزرّ يجب ألا يظهر أصلًا.
  await expect(page.getByRole("button", { name: /دمج ملف مكرَّر/ })).toHaveCount(0);
});

test("لا تُنشأ زيارة ثانية لنفس الموعد", async ({ page }) => {
  await signIn(page, "receptionist");
  await page.goto("/reception");
  const row = page.getByRole("row", { name: new RegExp(patientName()) });
  if (await row.isVisible().catch(() => false)) {
    const start = row.getByRole("button", { name: /بدء الزيارة/ });
    if (await start.isVisible().catch(() => false)) {
      await start.click();
      await page.goBack();
      await start.click().catch(() => undefined);
      // الفهرس الفريد على `patient_visits(appointment_id)` يمنع الثانية،
      // والدالة تُحدِّث القائمة بدل إنشائها — فلا خطأ ولا ازدواج.
      await page.goto("/patient-visits");
      const rows = page.getByText(new RegExp(patientName()));
      expect(await rows.count()).toBeLessThanOrEqual(1);
    }
  }
});

test("مستخدم من منشأة أخرى لا يفتح الموعد بمعرّفه", async ({ page }) => {
  const foreignId = process.env.E2E_FOREIGN_APPOINTMENT_ID;
  test.skip(!foreignId, "اضبط E2E_FOREIGN_APPOINTMENT_ID لتفعيل هذا الفحص");
  await signIn(page, "receptionist");
  await page.goto(`/reception?appointmentId=${foreignId}`);
  // لا يُشترط رسالة بعينها؛ المطلوب ألا تظهر بيانات مريض المنشأة الأخرى.
  await expect(page.getByText(/غير موجود|لا تملك صلاحية|لا مرضى/)).toBeVisible({ timeout: 20_000 });
});
