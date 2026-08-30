# دالة تذكيرات المواعيد

## النشر

```bash
supabase functions deploy appointment-reminders --no-verify-jwt
```

`--no-verify-jwt` لأن المُشغِّل ليس مستخدمًا مسجَّلًا. الحماية بديلة وأقوى:
ترويسة `x-cron-secret` تُفحص في أول سطر من الدالة قبل أي عمل.

## متغيّرات البيئة

```bash
supabase secrets set REMINDERS_CRON_SECRET="<سر طويل عشوائي>"
supabase secrets set SMS_PROVIDER_URL="https://api.<مزودك>/send"
supabase secrets set SMS_PROVIDER_TOKEN="<مفتاح المزود>"
```

`SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` تُضبطان تلقائيًا.

**بلا `SMS_PROVIDER_URL`** تُسجَّل الرسائل فشلًا دائمًا برسالة صريحة — لا
تبقى معلَّقة إلى الأبد بلا سبب ظاهر.

## الجدولة

من لوحة Supabase: **Edge Functions → appointment-reminders → Schedules**،
وأضف `*/5 * * * *` (كل خمس دقائق)، مع ترويسة `x-cron-secret`.

خمس دقائق تكفي: التذكير مجدول قبل 24 ساعة وقبل ساعتين، فتأخّر خمس دقائق لا
أثر له، والتشغيل كل دقيقة يستهلك حصة الاستدعاءات بلا فائدة.

بديل خارجي إن لم تتوفر الجدولة المدمجة (cron-job.org أو GitHub Actions):

```bash
curl -X POST "https://<project>.supabase.co/functions/v1/appointment-reminders" \
  -H "x-cron-secret: <السر>"
```

## الأمان

الدوال الأربع محجوبة عن `anon` و`authenticated`:

| الدالة | الدور |
|---|---|
| `app_process_due_appointment_reminders` | تحويل المهام المستحقة إلى رسائل |
| `app_claim_pending_messages` | سحب دفعة وتعليمها `processing` ذرّيًا |
| `app_mark_message_sent` | تأكيد التسليم |
| `app_mark_message_failed` | تسجيل الفشل وإعادة الجدولة |

لا يستطيع مستخدم مسجَّل استدعاء أيٍّ منها. والدالة تطلب فوق مفتاح الخدمة
ترويسة سرية خاصة بها، فلا يكفي تسريب المفتاح وحده لإغراق المرضى برسائل.

## دورة الحالة

```
pending ──claim──> processing ──ردّ المزوّد──> sent
                        │
                        └──فشل──> pending (تأجيل 5 ثم 25 ثم 125 دقيقة)
                                     └── بعد 3 محاولات ──> failed
```

`sent` لا تُكتب إلا بردّ المزوّد. و`appointments.sms_reminder_sent` لا يُضبط
إلا معها — لا عند إخراج الرسالة للطابور كما كان.

**إلغاء الموعد أو تغيير وقته** يُلغي الرسائل المعلَّقة تلقائيًا (مُحفِّز
`trg_cancel_pending_messages`)، ويعيد المُحفِّز جدولة التذكيرات على الوقت
الجديد. فلا يصل تذكير بموعد ملغى أو بوقت قديم.

## المتابعة

```sql
select status, count(*) from message_log
 where event_key = 'appointment_reminder' group by status;

select j.reminder_type, j.status, j.attempts, j.last_error
  from appointment_reminder_jobs j
 where j.status in ('failed','cancelled')
 order by j.updated_at desc limit 20;
```
