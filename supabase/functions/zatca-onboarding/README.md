# الربط مع ZATCA — الدالّتان الطرفيتان

| الدالّة | عملها | الصلاحية |
|---|---|---|
| `zatca-onboarding` | CSR، OTP، شهادة التوافق، اختبارات التوافق، شهادة الإنتاج، تفعيل/تعطيل الإنتاج | `integrations.manage` في المنشأة |
| `zatca-invoice` | إرسال فاتورة صادرة (أو إشعار دائن/مدين) للتصديق أو الإبلاغ | `billing.issue` في منشأة الفاتورة |

## قبل النشر

نفّذ على Supabase بالترتيب: `0178_zatca_onboarding.sql` ← `0179_zatca_production.sql` ← `0180_zatca_vault_credentials.sql`.

## النشر (من جهازك)

```bash
npx supabase login
npx supabase functions deploy zatca-onboarding --project-ref <PROJECT_REF>
npx supabase functions deploy zatca-invoice --project-ref <PROJECT_REF>
```

التحقّق من JWT يبقى مفعّلًا (الافتراضي): الواجهة ترسل رمز جلسة المستخدم، والدالّة تتحقّق منه ومن صلاحيته قبل أيّ عمل.

## متغيّرات البيئة

`SUPABASE_URL` و`SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` تُضبط تلقائيًا.
اختياريّ: `APP_ORIGIN` لقصر الاستدعاء على نطاق التطبيق:

```bash
npx supabase secrets set APP_ORIGIN="https://<نطاق-التطبيق>" --project-ref <PROJECT_REF>
```

لا أسرار ZATCA في متغيّرات البيئة: المفتاح الخاص وCSID والسرّ تُحفظ في Vault عبر دوال 0180.

## ما لا يدعمه هذا الإصدار بعد (يُرفض قبل الإرسال برسالة واضحة)

- البنود المعفاة أو الصفرية (غير 15%) — تحتاج فئة ضريبة وسبب إعفاء.
- الإرسال الحقيقي لفواتير التأمين المقسومة بين المريض والشركة.
- الخصم على مستوى الفاتورة غير الموزّع على البنود.
