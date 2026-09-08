# حالة العمل — ZainCare

**آخر تحديث: 2026-09-08.**

> النسخة السابقة من هذا الملفّ كانت متجمّدة عند عصر الترقية `0076` — تطلب تشغيل
> ترقيات نُفِّذت قبل 72 ترقية — فأُرشفت في
> [`archive/STATUS-2026-08-30.md`](archive/STATUS-2026-08-30.md). لا تُقرأ كحالة راهنة.

| للتفصيل | الملفّ |
| --- | --- |
| ما نُفِّذ على الإنتاج وما ينتظر | [`HANDOVER.md`](HANDOVER.md) |
| مرجع المخطط | [`SCHEMA.md`](SCHEMA.md) · [`SCHEMA-FUNCTIONS.md`](SCHEMA-FUNCTIONS.md) |
| ما بُني وما بقي في الواجهة | [`تدقيق-اللقطات-133-محدّث.md`](تدقيق-اللقطات-133-محدّث.md) |
| قواعد العمل للوكيل | [`../AGENTS.md`](../AGENTS.md) |

---

## الحالة الآن

- الترقيات `0001` → `0148` كلّها منفَّذة على الإنتاج (و`0066` أُعيد تنفيذها بعد
  أن تبيّن أنّها كانت جزئية: الجداول موجودة والدوالّ غائبة).
- آخر التزام مدفوع: `610687a`.
- مشكلة «الفاتورة لا تُحفظ من الشاشة» **حُلَّت**: لم تكن في القاعدة، بل رسالة
  خطأ مكتومة في طبقة العرض زالت مع النشر.
- `errorMessage()` معمَّم على المشروع كلّه — لا `instanceof Error` في `client/`.
- مرجع المخطط وُلِّد لأوّل مرّة (`scripts/schema-doc.py`).

## ما ينتظر المالك

```bash
cd D:\fusion-starter-108
pnpm test
pnpm build
git add -A
git status
git commit -F _to_delete/commit-msg.txt
git push
```

---

## أولويات الواجهة (من التدقيق المستقلّ)

| الأولوية | البند | لماذا |
| --- | --- | --- |
| **عالية** | شاشة تفعيل/تعطيل الموديولات | `organization_features` **يُقرأ ولا يُكتب إليه من أيّ موضع في الشيفرة** — فالتحكّم بالموديولات لكل منشأة غير ممكن أصلًا رغم جاهزية البنية |
| **عالية** | شاشة شركات زاتكا | `zatca_companies` تُقرأ في `Warehouses` و`Departments` عبر قوائم منسدلة، ولا شاشة تُنشئ شركة — فالقوائم فارغة أبدًا |
| **عالية** | تعديل الموردين والموظفين | `Procurement` و`Employees`: إنشاء بلا تعديل ولا تعطيل |
| متوسطة | `checked_in_2_at` (استقبال 2) | في `appointments` منذ `0002`، لا زرّ له في `Reception` |
| متوسطة | `lab_technician_name` / `_mobile` | في `distributors` منذ `0003`، لا حقل — فلا يُسجَّل فنّي معمل الأسنان |
| متوسطة | إدارة الأمراض وأكواد ICD10 | تُقرأ ولا تُدار |
| متوسطة | تجميعات حركات المستودع | حسب الصنف/المستودع/الطبيب |
| منخفضة | استيراد Excel/CSV، الطباعة الحرارية، نظام الترقيم، النسخ الاحتياطي | غائبة |

وجدول واحد ما زال بلا واجهة: `insurance_form_field_requirements`.

---

## نتائج المراجعة الشاملة (2026-09-08)

الدليل الخام مُولَّد في [`AUDIT-COMPLETENESS.md`](AUDIT-COMPLETENESS.md)
(`python scripts/completeness-audit.py`). ما يلي حُكمٌ عليه، مرتَّبًا بالخطورة.

### ✅ 1. ستّة كائنات تعمل في الإنتاج ولا يُنشئها أيّ ملفّ — عولجت بـ`0149`

| الكائن | تعتمد عليه |
| --- | --- |
| `custom_reports` | `CustomReports.tsx` |
| `document_templates` | `DocumentTemplates.tsx`، `DocumentsTab.tsx`، `Reports.tsx` |
| `generated_documents` | نفسها |
| `external_clients` | `ExternalClients.tsx`، `PriceLists.tsx` |
| `v_occupational_exam_report` (منظور) | `Reports.tsx` |

فُحصت **160 ملفّ SQL** في `migrations/` و`supabase/migrations/` بما فيها الحزم
المجمّعة: لا `create table` ولا `create view` لأيٍّ منها. ومع ذلك تشير إليها
ترقيات قائمة: `0072` فيها `references external_clients(id)` داخل `create table`،
و`0102` تُضيف أعمدة تشير إلى `document_templates` و`generated_documents` وتقرؤهما
في دوالّها، و`0051` تُنفّذ `alter view v_occupational_exam_report`، و`0148` تُضيف
لها مفاتيح ربط.

**الأثر:** `migrations/` **لا تستطيع إعادة بناء القاعدة من الصفر** — البناء
النظيف يتوقّف عند `0072`. وإن فُقد أحد هذه الكائنات من الإنتاج فلا مصدر يُستعاد
منه. أُنشئت خارج الترقيات (محرّر Supabase على الأرجح).

وسادسها `occupational_exam_results` — الجدول الذي يقرؤه المنظور، تُدرج فيه `0061`.

**الإصلاح:** `migrations/0149_adopt_orphan_objects.sql` — التعريفات منسوخة حرفيًّا
من الإنتاج، وكلّها محروسة بـ`if not exists` فلا تغيّر شيئًا على قاعدةٍ قائمة.
مُختبَرة على PostgreSQL 16 (نُفِّذت مرّتين متتاليتين) وقُورن ناتجها بالإنتاج قيدًا
قيدًا وفهرسًا فهرسًا وسياسةً سياسة فتطابق. **بعدها صار عدد الجداول 232 والمنظورات
175 — مطابقًا لفحص الإنتاج بالضبط**، وهو دليل على أنّ قائمة الأيتام اكتملت.

> على بناءٍ نظيف من الصفر يجب تنفيذ `0149` **قبل** `0051` و`0061` و`0072` و`0102`.

### 🟠 2. دوالّ حفظ ذرّية مبنيّة ولا يستدعيها أحد

`app_save_lab_test` و`app_save_radiology_exam` و`app_schedule_radiology_order`
موجودة في القاعدة ولا `.rpc()` واحد في العميل يناديها. شاشة المختبر تكتب
`lab_tests` مباشرةً بـ`.insert()` (سطر 404). أي أنّ ما تضمنه هذه الدوالّ من
تحقّق وذرّية **مُتجاوَز** — وهو خرق مباشر لقاعدة «العمليات متعدّدة الخطوات داخل
RPC ذرّية».

### 🟠 3. طبقة تقارير موازية غير موصولة

**20 منظورًا** باسم `v_report_*` لا يقرؤها العميل ولا القاعدة، بينما `Reports.tsx`
يقرأ مجموعة أخرى تمامًا (`v_daily_revenue`، `v_sales_by_item`، `app_revenue_by_doctor`…).
فللإيراد تعريفان: `v_revenue_by_doctor` (لا يقرؤه أحد) و`app_revenue_by_doctor`
(المستعمَل). تعريفان يفترقان مع الوقت، وأحدهما يُصدَّق يومًا ما وهو خطأ.

### 🟡 4. ثلاثة جداول تُقرأ وتبقى فارغة أبدًا

لا العميل يكتب إليها، ولا دالّة، ولا بذرة في أيّ ترقية:

- `procedure_codes` — `ReferenceData.tsx` (الشاشة نفسها تقول «لا أكواد محمَّلة بعد»)
- `tooth_shades` و`tooth_shade_guides` — `DentalLab.tsx`: منتقي درجة اللون فارغ دائمًا

### 🟡 5. جدولان يُكتب إليهما ولا يقرؤهما أحد

- `consultation_fee_settings` — يُحفظ من إعدادات التشغيل ولا يقرؤه شيء (نفس
  عائلة `vat_responsibility`: إعداد يُضبط ولا يُطبَّق).
- `dental_lab_order_items` — بنود أوامر معمل الأسنان تُسجَّل ولا تُعرض.

### ⚪ 6. سطح ميت تمامًا

أربعة جداول لا يمسّها أحد لا من الواجهة ولا من القاعدة ولا ببذرة:
`bank_reconciliation_lines`، `lab_result_attachments`، `purchase_approval_rules`،
`reception_settings`. ومعها **15 دالّة** و**36 منظورًا** بلا مستدعٍ.

## سطح ميت — للمراجعة لا للتنفيذ الآن

بُني في القاعدة ولا تستعمله شاشة. تركه يعني تعريفَين يفترقان مع الوقت:

- `app_resolve_vat_rate` و`app_discount_within_limits` — دالّتان لا يستدعيهما
  العميل، والشاشات تحسب الضريبة والخصم بنفسها.
- أعمدة الأطباء: `signature_url`، `stamp_url`، `order_stamp_url`،
  `use_default_signature`، `use_default_stamp`، `medical_record_sections`،
  `allowed_booking_user_ids`، `consultation_fee_service_codes`.
- `insurance_settings.notify_roles_on_doctor_edits` وأخواتها — إشعارات تعديلات
  التأمين لم تُبنَ.
- `blocked_external_contacts.phone_number` و`lifted_by`.
- `items.track_expiry` و`items.vat_rate_override`.

---

## قرارات ما زالت للمالك

| القرار | الوضع المُثبَت اليوم |
| --- | --- |
| دلالة `vat_responsibility` | `insurance_settings.vat_responsibility` موجود منذ `0005` بلا قيد `check`، ولا يقرؤه أيّ حساب. الشاشة تعرضه داخل صندوق «تُحفظ ولا تُطبَّق». وأنواعه متضاربة: `patient\|insurance_company\|by_item_category` في `database.types.ts` مقابل `patient\|company` في `insurance-settings.ts` |
| دوام الطبيب: تحذير أم منع | `checkDoctorAvailability` تُعيد `outside` حين يقع جزء من الموعد خارج الدوام. `Appointments` **يحذّر** ويسمح بالتجاوز (`allowOutsideHours`)، و`Waitlist` **يمنع**. وحين لا دوام مُسجَّل إطلاقًا تُعيد `unknown` فيمرّ الحجز (fail-open مقصود) |
| ربط العروض بالفواتير | `app_resolve_discount` تقرأ `offers` وتُستدعى في `Billing.addLine`، لكن `sales_invoices.applied_offer_id` و`offer_percent` **لا يكتبهما أحد** — فلا يُعرف بعد الفوترة أيّ عرض طُبِّق، وتقرير الخصم في `Reports` يحسب `subtotal × offer_percent` وهو صفر دائمًا |
| `lab_order_items.unit_override` | موجود منذ `0013`، لا يقرؤه ولا يكتبه شيء |

> ملاحظة: البند القديم «تغيير Builder.io في `doctor-availability.ts`» **سقط**:
> الملفّ لا يذكر Builder.io بحرف، والسؤال الحيّ هو تحذير/منع أعلاه.
