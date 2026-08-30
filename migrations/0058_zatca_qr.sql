-- ---------------------------------------------------------------------------
-- 0058_zatca_qr.sql — توليد رمز QR لفاتورة زاتكا (المرحلة الأولى)
-- ---------------------------------------------------------------------------
-- `sales_invoices.zatca_qr` عمود قائم منذ 0003 ولم يُكتب فيه شيء قط. أي أن كل
-- فاتورة صدرت من النظام تخرج بلا رمز QR — وهو مطلب إلزامي في **المرحلة
-- الأولى** من الفوترة الإلكترونية السعودية لفواتير البيع المبسَّطة.
--
-- ما تفرضه المرحلة الأولى: رمز QR يحمل خمسة حقول بترميز TLV ثم Base64:
--
--   1  اسم البائع
--   2  الرقم الضريبي للبائع
--   3  تاريخ ووقت الفاتورة (ISO-8601، بتوقيت UTC)
--   4  إجمالي الفاتورة شاملًا الضريبة
--   5  مبلغ ضريبة القيمة المضافة
--
-- **حدود هذا الملف — تُقرأ قبل الاعتماد عليه:**
--
--   • المرحلة الثانية (الربط) تتطلب ختمًا تشفيريًا وشهادة من هيئة الزكاة
--     والضريبة والجمارك وبثًّا لكل فاتورة إلى منصّتها. لا شيء من ذلك هنا،
--     ولا يُغني هذا الملف عنه.
--   • لا يُولَّد رمز لمنشأة **بلا رقم ضريبي**: عيادة غير مسجَّلة في ضريبة
--     القيمة المضافة لا يجوز أن تُصدر رمزًا يوحي بأنها مسجَّلة. العمود يبقى
--     فارغًا، وهو الصواب لا نقص.
--   • الطول في TLV بايت واحد، فالحقل الذي يتجاوز 255 بايت يُقصَّر (اسم منشأة
--     طويل جدًا). التقصير مقصود ومحدود بالاسم وحده.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1) وحدة TLV
--
-- `octet_length` لا `length`: الوسم يحمل طول **البايتات** لا الأحرف. واسم
-- منشأة عربي يبلغ ضعف طوله بالأحرف في UTF-8، فاستعمال `length` كان يُنتج رمزًا
-- تالفًا لا يقرؤه أي تطبيق تحقّق — وهو عطل لا يظهر إلا عند مسح الرمز فعليًا.
-- ---------------------------------------------------------------------------
create or replace function app_zatca_tlv(p_tag integer, p_value text)
returns bytea
language sql
immutable
as $$
  select case
    when p_value is null or btrim(p_value) = '' then ''::bytea
    else
      decode(
        lpad(to_hex(p_tag), 2, '0') ||
        lpad(to_hex(octet_length(convert_to(v.val, 'UTF8'))), 2, '0'),
        'hex'
      ) || convert_to(v.val, 'UTF8')
  end
  from (select left(btrim(p_value), 120) as val) v;
$$;

comment on function app_zatca_tlv(integer, text) is
  'يبني حقل TLV واحدًا لرمز QR (زاتكا، المرحلة الأولى): بايت الوسم + بايت الطول بالبايتات + القيمة UTF-8.';

-- ---------------------------------------------------------------------------
-- 2) مُحفِّز التوليد
--
-- مُحفِّز لا تعديلٌ في `app_create_sales_invoice`: الرمز يعتمد على الإجماليات
-- التي تُكتب في تحديث لاحق للرأس، وأي فاتورة تُنشأ بمسار آخر (استيراد،
-- تصحيح يدوي) تستحق رمزًا صحيحًا أيضًا. ربط التوليد بالجدول لا بالدالة يجعل
-- الرمز خاصيةً للفاتورة لا أثرًا جانبيًا لطريقة إنشائها.
--
-- ويُعاد التوليد متى تغيّر الصافي أو الضريبة: فاتورة عُدِّلت إجمالياتها ثم
-- بقي رمزها القديم أسوأ من فاتورة بلا رمز — الرمز يقول رقمًا والفاتورة تقول
-- غيره.
-- ---------------------------------------------------------------------------
create or replace function app_sales_invoice_zatca_qr()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_vat  text;
begin
  select o.name, nullif(btrim(o.tax_number), '')
    into v_name, v_vat
    from organizations o
   where o.id = new.organization_id;

  -- منشأة بلا رقم ضريبي: لا رمز. غيابه إفصاح صحيح لا نقص.
  if v_vat is null then
    new.zatca_qr := null;
    return new;
  end if;

  new.zatca_qr := encode(
      app_zatca_tlv(1, v_name)
   || app_zatca_tlv(2, v_vat)
   || app_zatca_tlv(3, to_char(coalesce(new.created_at, now()) at time zone 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   || app_zatca_tlv(4, to_char(coalesce(new.net_amount, 0), 'FM999999999990.00'))
   || app_zatca_tlv(5, to_char(coalesce(new.vat_amount, 0), 'FM999999999990.00')),
    'base64');

  -- `encode(...,'base64')` يُدرج سطورًا جديدة كل 76 حرفًا. رمز QR يحمل سلسلة
  -- واحدة، والسطر الجديد داخلها يفسدها عند بعض القارئات.
  new.zatca_qr := replace(replace(new.zatca_qr, e'\n', ''), e'\r', '');
  return new;
end;
$$;

drop trigger if exists trg_sales_invoice_zatca_qr on sales_invoices;
create trigger trg_sales_invoice_zatca_qr
before insert or update of net_amount, vat_amount, created_at on sales_invoices
for each row execute function app_sales_invoice_zatca_qr();

-- ---------------------------------------------------------------------------
-- 3) الفواتير الصادرة قبل اليوم
--
-- تُعاد كتابة رمزها من بياناتها المخزَّنة. لا تغيير في أي رقم — فقط ملء عمود
-- كان فارغًا. الفواتير التي لا رقم ضريبي لمنشأتها تبقى فارغة.
-- ---------------------------------------------------------------------------
update sales_invoices s
   set zatca_qr = replace(replace(encode(
          app_zatca_tlv(1, o.name)
       || app_zatca_tlv(2, nullif(btrim(o.tax_number), ''))
       || app_zatca_tlv(3, to_char(s.created_at at time zone 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
       || app_zatca_tlv(4, to_char(coalesce(s.net_amount, 0), 'FM999999999990.00'))
       || app_zatca_tlv(5, to_char(coalesce(s.vat_amount, 0), 'FM999999999990.00')),
       'base64'), e'\n', ''), e'\r', '')
  from organizations o
 where o.id = s.organization_id
   and nullif(btrim(o.tax_number), '') is not null
   and s.zatca_qr is null;

commit;
