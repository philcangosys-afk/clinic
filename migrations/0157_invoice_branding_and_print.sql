-- =============================================================================
-- 0157_invoice_branding_and_print.sql
-- هويّة الفاتورة المطبوعة: الشعار والعنوان وشروط المجمع، ومصدرٌ واحد لبياناتها.
-- =============================================================================
--
-- **ما كان ينقص:** طباعة الفاتورة كانت جدولًا أبيض بلا هوية — لا شعار، ولا
-- اسم قانونيّ، ولا عنوان، ولا رقم ضريبيّ للعميل، ولا عمر ولا جنسية ولا رقم
-- هوية ولا رقم ملف، ولا تفصيل للمدفوع بطرقه، ولا شروط المجمع. والورقة التي
-- يأخذها المريض هي وجه المنشأة عنده، وهي أيضًا وثيقةٌ قد تُراجَع.
--
-- و`print_settings.show_logo` موجود منذ 0010 ويُحفَظ من شاشة الإعدادات —
-- **ولا شعار في القاعدة أصلًا**: لا عمود يحمل مساره ولا دلو يخزّنه. إعدادٌ
-- يسأل «أظهر الشعار؟» عن شيء لا وجود له.
--
-- ثلاثة أقسام: أعمدة الهويّة، ودلو التخزين، ومنظور الطباعة.
--
-- إضافةٌ محضة: أعمدة تُلحق بجدول إعدادات، ودلو جديد، ومنظور جديد.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- ١) أعمدة هويّة الفاتورة المطبوعة
--
-- **الشروط مصفوفة لا نصٌّ واحد:** «للمريض الحق في المراجعة المجانية خلال ١٤
-- يومًا» و«الفاتورة تخضع لسياسة الاسترداد» بندان مستقلّان يُحرَّران ويُرتَّبان
-- ويُحذف أحدهما دون الآخر. حشرهما في `footer_note` نصًّا واحدًا يجعل تعديل
-- بندٍ إعادةَ كتابة الجميع.
-- ═══════════════════════════════════════════════════════════════════════════

alter table print_settings
  add column if not exists logo_url             text,
  add column if not exists invoice_address_line text,
  add column if not exists invoice_policy_lines text[] not null default '{}';

comment on column print_settings.logo_url is
  'مسار شعار المنشأة في دلو clinic-branding. فارغٌ يعني لا شعار مهما كان show_logo.';
comment on column print_settings.invoice_address_line is
  'سطر العنوان أسفل اسم المنشأة في الفاتورة. فارغٌ يُركَّب من العنوان الوطنيّ في organization_vat_settings.';
comment on column print_settings.invoice_policy_lines is
  'شروط المجمع أسفل الفاتورة، بندًا بندًا وبترتيبها. مصفوفة لا نصّ: البند يُحرَّر ويُحذف وحده.';


-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) دلو الشعار
--
-- **عامٌّ لا خاصّ**، خلافًا لدلوَي المستندات والنتائج. الشعار يُعرض في نافذة
-- طباعة وفي رسالةٍ تصل المريض، وكلاهما لا يحمل ترويسة استيثاق — ورابطٌ موقَّع
-- ينتهي بعد ساعة يترك الفاتورة المحفوظة بلا شعار. والشعار ليس بيانًا حسّاسًا:
-- هو معلَّق على باب العيادة.
--
-- والكتابة تبقى للأعضاء وحدهم: العموميّة في القراءة لا في الرفع.
--
-- المسار: {organization_id}/logo-{ts}.{ext} — الجزء الأول تُبنى عليه السياسات.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
select 'clinic-branding', 'clinic-branding', true
where not exists (select 1 from storage.buckets where id = 'clinic-branding');

drop policy if exists "clinic_branding_read_public" on storage.objects;
create policy "clinic_branding_read_public" on storage.objects
  for select using (bucket_id = 'clinic-branding');

drop policy if exists "clinic_branding_insert_members" on storage.objects;
create policy "clinic_branding_insert_members" on storage.objects
  for insert with check (
    bucket_id = 'clinic-branding'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "clinic_branding_update_members" on storage.objects;
create policy "clinic_branding_update_members" on storage.objects
  for update using (
    bucket_id = 'clinic-branding'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "clinic_branding_delete_members" on storage.objects;
create policy "clinic_branding_delete_members" on storage.objects
  for delete using (
    bucket_id = 'clinic-branding'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) منظور الطباعة — قراءةٌ واحدة بدل ستّ
--
-- الفاتورة المطبوعة تحتاج بيانات من سبعة جداول. جمعها في الواجهة سبعة نداءات
-- متتابعة قبل أن تُفتح نافذة الطباعة، وسبعة مواضع يختلف فيها اشتقاق الحقل بين
-- شاشةٍ وأخرى — والاسم القانونيّ والعنوان يجب أن يكونا واحدًا في كل ورقة.
--
-- **الاسم المعروض:** الاسم القانونيّ من إعدادات الضريبة إن وُجد، وإلا اسم
-- المنشأة. الورقة الضريبية تحمل الاسم القانونيّ لا الاسم التجاريّ.
--
-- **الرقم الضريبيّ للبائع:** رقم التسجيل الضريبيّ إن وُجد، وإلا `tax_number`.
-- ═══════════════════════════════════════════════════════════════════════════

drop view if exists v_invoice_print;
create view v_invoice_print
with (security_invoker = on) as
select
  inv.id                                    as invoice_id,
  inv.organization_id,
  inv.branch_id,
  inv.invoice_number,
  inv.document_prefix,
  inv.document_number,
  inv.invoice_type,
  inv.document_type,
  inv.is_temporary,
  inv.status,
  coalesce(inv.issued_at, inv.created_at)   as invoice_at,

  -- ── البائع ───────────────────────────────────────────────────────────────
  coalesce(nullif(btrim(vs.legal_name_ar), ''), o.name)      as seller_name,
  vs.legal_name_en                                           as seller_name_en,
  coalesce(nullif(btrim(vs.vat_registration_number), ''),
           nullif(btrim(o.tax_number), ''))                  as seller_tax_number,
  vs.cr_number                                               as seller_cr_number,
  -- العنوان المكتوب يدويًّا يسبق المركَّب: صيغة العنوان الوطنيّ ليست ما
  -- يعرفه المريض، وصاحب المنشأة أدرى بكيف يُكتب عنوانه على ورقته
  coalesce(
    nullif(btrim(ps.invoice_address_line), ''),
    nullif(btrim(concat_ws(' - ',
      nullif(btrim(vs.city), ''),
      nullif(btrim(vs.district), ''),
      nullif(btrim(vs.street_name), ''))), '')
  )                                                          as seller_address,

  -- ── الطباعة ──────────────────────────────────────────────────────────────
  ps.logo_url,
  coalesce(ps.show_logo, true)                               as show_logo,
  ps.footer_note,
  coalesce(ps.invoice_policy_lines, '{}')                    as policy_lines,
  coalesce(ps.invoice_paper_size, 'a4')                      as paper_size,

  -- ── العميل ───────────────────────────────────────────────────────────────
  inv.patient_id,
  coalesce(p.name_ar, inv.external_customer_name)            as customer_name,
  p.file_number                                              as customer_file_number,
  coalesce(p.id_number, inv.id_number)                       as customer_id_number,
  p.tax_number                                               as customer_tax_number,
  p.birth_date                                               as customer_birth_date,
  coalesce(nat.name_ar, inv_nat.name_ar)                     as customer_nationality,
  nat.name_en                                                as customer_nationality_en,
  coalesce(p.mobile_number, p.phone_1, inv.external_customer_mobile) as customer_mobile,
  p.email_1                                                  as customer_email,
  -- العمر لحظة الطباعة، مفصَّلًا كما في إيصال العيادات: سنة وشهر ويوم
  case when p.birth_date is not null
       then extract(year from age(current_date, p.birth_date))::int end  as age_years,
  case when p.birth_date is not null
       then extract(month from age(current_date, p.birth_date))::int end as age_months,
  case when p.birth_date is not null
       then extract(day from age(current_date, p.birth_date))::int end   as age_days,

  -- ── السياق السريريّ ──────────────────────────────────────────────────────
  d.name_ar                                                  as doctor_name,
  c.name                                                     as clinic_name,

  -- ── المبالغ ──────────────────────────────────────────────────────────────
  inv.subtotal_amount,
  inv.discount_amount,
  inv.vat_amount,
  inv.exemption_amount,
  inv.net_amount,
  inv.paid_amount,
  inv.remaining_amount,
  inv.is_insurance_invoice,
  inv.insurance_company_name,
  inv.insurance_share_amount,
  inv.patient_share_amount,
  inv.note,
  inv.zatca_qr
from sales_invoices inv
join organizations o          on o.id = inv.organization_id
left join organization_vat_settings vs on vs.organization_id = inv.organization_id
left join print_settings ps   on ps.organization_id = inv.organization_id
left join patients p          on p.id = inv.patient_id
left join lookup_values nat     on nat.id = p.nationality_value_id
left join lookup_values inv_nat on inv_nat.id = inv.nationality_value_id
left join doctors d           on d.id = inv.doctor_id
left join clinics c           on c.id = inv.clinic_id;

comment on view v_invoice_print is
  'كل ما تحتاجه الفاتورة المطبوعة في قراءةٍ واحدة: البائع وهويّته، والعميل وعمره وجنسيته، والطبيب والعيادة، والمبالغ، والشعار والشروط.';

grant select on v_invoice_print to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) تفصيل المدفوع بطرقه
--
-- الإيصال يقول «نقدي ١٥٠ · شبكة ٠ · المدفوع ١٥٠» لا «المدفوع ١٥٠» وحدها:
-- المريض يراجع ما دفعه بكل طريقة، والصرّاف يُجرد صندوقه على الورقة نفسها.
--
-- **الربط عبر `voucher_invoice_allocations` لا عبر `related_sales_invoice_id`:**
-- السند الواحد قد يُوزَّع على عدّة فواتير، والتخصيص هو ما تقرؤه
-- `app_recalc_invoice_payment_status` لتحسب `paid_amount`. الاعتماد على عمود
-- الفاتورة في السند كان سيُخرج مجموعًا يخالف ما تعرضه الفاتورة نفسها.
--
-- وقاعدة الإشارة منسوخة من تلك الدالّة حرفًا بحرف: القبض موجب، والمصروف
-- المرتبط بسند قبضٍ سابق (`refund_of_voucher_id`) مرتجعٌ يُطرح. وما عداهما
-- ليس تحصيلًا على الفاتورة فلا يدخل.
-- ═══════════════════════════════════════════════════════════════════════════

drop view if exists v_invoice_payment_methods;
create view v_invoice_payment_methods
with (security_invoker = on) as
select
  a.sales_invoice_id                                    as invoice_id,
  v.organization_id,
  v.payment_method_value_id,
  coalesce(m.name_ar, 'غير محدَّدة')                    as method_name,
  m.code                                                as method_code,
  sum(case when v.voucher_type = 'receipt' then a.amount else -a.amount end) as amount
from voucher_invoice_allocations a
join financial_vouchers v on v.id = a.voucher_id
left join lookup_values m on m.id = v.payment_method_value_id
where coalesce(v.is_void, false) = false
  and (
    v.voucher_type = 'receipt'
    or (v.voucher_type = 'expense' and v.refund_of_voucher_id is not null)
  )
group by a.sales_invoice_id, v.organization_id,
         v.payment_method_value_id, m.name_ar, m.code
having sum(case when v.voucher_type = 'receipt' then a.amount else -a.amount end) <> 0;

comment on view v_invoice_payment_methods is
  'ما قُبض على الفاتورة موزَّعًا على طرق الدفع — من التخصيصات لا من عمود الفاتورة في السند، بلا الملغاة، والمرتجع مطروح.';

grant select on v_invoice_payment_methods to authenticated;

notify pgrst, 'reload schema';
