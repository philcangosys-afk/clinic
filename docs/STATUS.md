# حالة العمل — ما جاهز وما ينتظرك

## الخلاصة في سطرين

كل ما طلبته مبنيّ ومفحوص ومسلَّم إلى `D:\fusion-starter-108`. المتبقّي كله
**عليك**: تشغيل الهجرات، ثم الدفع والنشر، ثم تسجيل الدخول.

---

## ما ينتظرك — بالترتيب

### ١) تشغيل الهجرات في Supabase

بالترتيب، واحدة واحدة، في محرّر SQL:

```
0062_permissions_and_branch_isolation.sql
0063_contact_blocks.sql
0064_reschedule_and_availability.sql
0065_reception_board.sql
0066_patient_profile_and_merge.sql
0067_patient_timeline.sql
0068_reception_reports.sql
0069_reminder_ui_and_language.sql
0070_reminder_schedule_headers_fix.sql
0071_service_catalog_core.sql
0072_price_lists.sql
0073_service_clinical_and_lifecycle.sql
0074_appointment_service_link.sql
0075_package_usage_guards.sql
0076_catalog_followups.sql
```

الترتيب ليس تفضيلًا: `0072` تعتمد على أعمدة `0071`، و`0074` تعيد تعريف دالة
من `0073`، و`0075` تستدعي دالة `0074`.

### ٢) الدفع والنشر

```bash
cd D:\fusion-starter-108
git add -A
git commit -m "كتالوج الخدمات: البيانات والأسعار والمتطلّبات ودورة الحياة"
git push
```

Netlify يبني تلقائيًا بعد الدفع.

### ٣) بعد النشر — خطوة واحدة لازمة

أنشئ **قائمة أساس** واحدة من شاشة «قوائم الأسعار». بدونها لا يتعطّل شيء:
كل خدمة تُفوتَر بسعرها المسجَّل عليها كما هو الحال اليوم. لكن قوائم الفروع
والتأمين لا معنى لها بلا أساس تُقاس عليه.

### ٤) تسجيل الدخول

ثم أخبرني، فأبدأ الفحص على الواجهة الحيّة — وهو الشيء الوحيد الذي لا أستطيع
فعله بنفسي، لأنني لا أتعامل مع كلمات المرور.

---

## ما بُني في هذه الجولة

| الهجرة | المحتوى |
|---|---|
| 0071 | بيانات الخدمة، الفروع، الأرشفة، صلاحيات الكتالوج |
| 0072 | قوائم الأسعار والتاريخ وحسم السعر |
| 0073 | المتطلّبات السريرية، الموارد، أكواد المطالبات، دورة الحياة |
| 0074 | ربط الموعد بالخدمة، ومنظور غير المفوتر |
| 0075 | حراس استهلاك الباقات |
| 0076 | إغلاق السطح الميت |

| الشاشة | الملف |
|---|---|
| كتالوج الخدمات | `client/pages/Services.tsx` |
| قوائم الأسعار | `client/pages/PriceLists.tsx` |
| الموارد | `client/pages/Resources.tsx` |
| محرّر الخدمة | `client/components/catalog/ServiceEditorDialog.tsx` |
| أسعار خدمة | `client/components/catalog/ServicePriceLists.tsx` |
| غير المفوتر | `client/components/reports/UnbilledServices.tsx` |
| الإقرارات المعلّقة | `client/components/reports/PendingConsents.tsx` |

وشاشات عُدِّلت لتستعمل ما بُني: `MedicalRecords` (فحص الملاءمة وحسم السعر)،
`Appointments` (الخدمة تضبط المدة والعيادة)، `Packages` (الاستهلاك عبر الدالة)،
`VisitCanvasDetail` (حالة كل خدمة وزرّ الإلغاء)، `Reports` (تبويب المعلّقات).

---

## الفحص الأخير — أُجري كاملًا من قاعدة فارغة

| الفحص | النتيجة |
|---|---|
| السلسلة `0001 → 0076` من قاعدة فارغة | نظيفة |
| `e2e/sql/db-guards.test.sql` (٨ فحوص) | نجحت |
| `e2e/sql/catalog-guards.test.sql` (١٦ فحصًا) | نجحت |
| `scripts/schema-check.py` على **كل** ملفات العميل | صفر مخالفات |
| `tsc` على كل ملف مسّته هذه الجولة | نظيف |

الملفان الاختباريان يعملان داخل معاملة تُلغى، فلا يتركان صفًا واحدًا، وشُغِّلا
مرتين متتاليتين على القاعدة نفسها. ومُختبَران **بالطفرة**: تعطيل حارس دورة
الحياة أسقط الاختبار كما يجب.

---

## أدوات الفحص

```bash
# تطابق الاستعلامات مع المخطط
psql -Atc "select table_name||'|'||column_name from information_schema.columns
           where table_schema='public'" > cols.txt
psql -Atc "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public'" > fns.txt
python3 scripts/schema-check.py cols.txt fns.txt client

# سطحٌ ميت: دوال ومناظير وأعمدة لا يستعملها أحد
psql -Atc "select table_name from information_schema.views
           where table_schema='public'" > views.txt
python3 scripts/dead-surface.py cols.txt fns.txt views.txt migrations client
```

---

## متروك عمدًا — للمراجعة لا للتنفيذ الآن

هذه كشفها فحص «السطح الميت» وهي **سابقة لعملي**، فلم ألمسها:

- `app_resolve_vat_rate` و`app_discount_within_limits` — دالّتان لا يستدعيهما
  العميل، والشاشات تحسب الضريبة والخصم بنفسها. تعريفان يفترقان مع الوقت.
- أعمدة الأطباء: `signature_url`، `stamp_url`، `order_stamp_url`،
  `use_default_signature`، `use_default_stamp`، `medical_record_sections`،
  `allowed_booking_user_ids`، `consultation_fee_service_codes` — لا شاشة
  تكتبها.
- `insurance_settings.notify_roles_on_doctor_edits` وأخواتها — إشعارات
  تعديلات التأمين لم تُبنَ.
- `blocked_external_contacts.phone_number` و`lifted_by`.
- `items.track_expiry` و`items.vat_rate_override`.

قل لي أيّها تريد وأبدأ به.

## قرارات ما زالت لك

- دلالة `vat_responsibility`.
- تغيير Builder.io في `doctor-availability.ts` (fail-closed) — أُبقيه أم يُعدَّل.
- ربط العروض بالفواتير (`applied_offer_id` / `offer_percent`).
- `lab_order_items.unit_override`.
