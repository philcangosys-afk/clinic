-- ---------------------------------------------------------------------------
-- 0168 — الفاتورة تُطبّق العرض، وتكتب المجانيّ والخصم المسبَّب
--
-- 0167 أنشأت العروض، وأباحت المجانيّ، وطلبت سببًا للخصم، وحرست كل ذلك
-- بمُحفِّزٍ على سطر الفاتورة. لكنّ **الكاتب الوحيد لسطور الفواتير في هذا
-- النظام هو `app_create_sales_invoice`، وهي تُسمّي أعمدتها صراحةً** — فلا
-- `is_complimentary` فيها ولا `complimentary_reason` ولا `discount_reason`.
-- أي أنّ الميزتين تُرسَلان من الشاشة فتُهمَلان بصمت، تمامًا كما أُهمل
-- `min_price` في `app_save_service` حتى القسم السابع من 0167.
--
-- وهذه الترقية تُصلح ثلاثة أشياء في تلك الدالّة:
--
--   (١) **العرض يُطبَّق في القاعدة لا في المتصفّح.** لو بقي تطبيقه في الشاشة
--       لكفى تعديلُ الطلب قبل إرساله ليُفوَّتر الصنف بسعر القائمة والعرض
--       معلَنٌ للناس — ولَما رآه أيّ كاتبٍ آخر للفواتير. فالسعر يُحسَب هنا:
--       العرض النشط اليوم يتقدّم على ما يرسله العميل.
--
--       ويُستثنى المرتجع والفاتورة المرتبطة بأصل: المرتجع يُعيد **ما فُوتر
--       فعلًا** لا سعر اليوم، وعرضٌ بدأ بعد الفاتورة الأصلية كان سيُنقص
--       المُعاد للمريض.
--
--   (٢) **المجانيّ سطرٌ بصفرٍ محسوبٍ في القاعدة.** لا سعر ولا خصم ولا ضريبة
--       ولا صافي — فقيد 0167 يفرض الأصفار، والحساب هنا يُنتجها بالبناء لا
--       بأمانة المتصفّح.
--
--   (٣) **الخصم بمبلغٍ لا بنسبةٍ فقط.** «الخدمة بمئة والمريض يدفع تسعين»
--       خصمٌ بعشرة ريالات، وتحويلها إلى نسبةٍ يُنتج كسورًا تُقرَّب فيخرج
--       ٨٩٫٩٩. و`discount_amount` كان يُكتب محسوبًا من النسبة وحدها، فأُضيف
--       المبلغ المُرسَل إليه، **بسقف مجموع السطر** حتى لا يخرج صافٍ سالب.
--
-- والترقيع بالنصّ عند خمسة مرابط لا إعادة كتابة: الدالّة زهاء 500 سطر تحمل
-- ضريبةَ الجنسية (0147/0152/0156) وحصّتي التأمين وختمَ الطلبات والدفعات،
-- وإعادة كتابتها تُخفي هذا التغيير في ضجيج النقل. وإن تغيّر مربطٌ لاحقًا
-- تتعطّل الترقية بخطأٍ صريح بدل أن تنجح ناقصةً.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- **كلّ مربطٍ متعدّد الأسطر يُجرَّد من \r قبل البحث به.**
--
-- الملفّ يُنسَخ ويُلصَق في محرّر SQL، وطريقُ اللصق قد يُحوّل نهاياته إلى
-- CRLF — فيصير في داخل النصّ المطلوب البحث عنه `\r\n` بينما نصُّ الدالّة
-- المخزَّن جُرِّد من `\r`. فلا يتطابقان، وتتعطّل الترقية عند مربطٍ موجودٍ
-- فعلًا. وقع هذا في 0167 عند المالك، فجُرِّد الجانبان هنا سلفًا.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_sales_invoice'
   order by p.oid desc
   limit 1;
  if v_src is null then
    raise exception 'app_create_sales_invoice غير موجودة — نفِّذ 0052 ثم 0160 أوّلًا';
  end if;

  -- نهايات الأسطر: النصّ المخزَّن يحمل \r إن نُفِّذت الترقية من ملفٍّ بنهايات
  -- ويندوز، فلا تطابق المرابط المكتوبة هنا بـ\n.
  v_src := replace(v_src, chr(13), '');

  if position('is_complimentary' in v_src) > 0 then
    return; -- مُرقَّعة سلفًا
  end if;

  v_new := v_src;

  -- ── المربط ١: قائمة أعمدة الإدراج ───────────────────────────────────────
  if position(replace('    net_amount, doctor_id, agreement_item_id, line_type, source_barcode,
    visit_service_id
  )', chr(13), '') in v_new) = 0 then
    raise exception 'app_create_sales_invoice: تعذّر العثور على قائمة أعمدة الإدراج';
  end if;
  v_new := replace(v_new,
    replace('    net_amount, doctor_id, agreement_item_id, line_type, source_barcode,
    visit_service_id
  )', chr(13), ''),
    replace('    net_amount, doctor_id, agreement_item_id, line_type, source_barcode,
    visit_service_id,
    is_complimentary, complimentary_reason, discount_reason
  )', chr(13), ''));

  -- ── المربط ٢: قائمة قيم الإدراج ─────────────────────────────────────────
  if position(replace('    nullif(e ->> ''visit_service_id'','''')::uuid
  from jsonb_array_elements(p_items) e', chr(13), '') in v_new) = 0 then
    raise exception 'app_create_sales_invoice: تعذّر العثور على قائمة قيم الإدراج';
  end if;
  v_new := replace(v_new,
    replace('    nullif(e ->> ''visit_service_id'','''')::uuid
  from jsonb_array_elements(p_items) e', chr(13), ''),
    replace('    nullif(e ->> ''visit_service_id'','''')::uuid,
    q.comp,
    case when q.comp then nullif(btrim(e ->> ''complimentary_reason''),'''') else null end,
    case when q.line_discount > 0 then nullif(btrim(e ->> ''discount_reason''),'''') else null end
  from jsonb_array_elements(p_items) e', chr(13), ''));

  -- ── المربط ٣: سعر السطر — العرض والمجانيّ ────────────────────────────────
  if position('        coalesce(nullif(e ->> ''price'','''')::numeric, i.price, 0)            as price,' in v_new) = 0 then
    raise exception 'app_create_sales_invoice: تعذّر العثور على تعبير السعر';
  end if;
  v_new := replace(v_new,
    '        coalesce(nullif(e ->> ''price'','''')::numeric, i.price, 0)            as price,',
    replace('        case
          -- المجانيّ صفرٌ محسوبٌ هنا: قيد 0167 يفرض الأصفار، وهذا يُنتجها
          when coalesce(nullif(e ->> ''is_complimentary'','''')::boolean, false) then 0
          -- العرض النشط اليوم يتقدّم على ما يرسله العميل — إلّا في المرتجع
          else coalesce(
                 case when coalesce(p_invoice_type, ''sale'') = ''sale''
                       and p_original_invoice_id is null then (
                   select o.offer_price
                     from item_offers o
                    where o.item_id = nullif(e ->> ''item_id'','''')::uuid
                      and o.organization_id = p_organization_id
                      and o.is_disabled = false
                      and (o.start_date is null or o.start_date <= current_date)
                      and (o.end_date   is null or o.end_date   >= current_date)
                    order by o.start_date desc nulls last
                    limit 1)
                 end,
                 nullif(e ->> ''price'','''')::numeric, i.price, 0)
        end                                                                as price,', chr(13), ''));

  -- ── المربط ٤: النسبة والمبلغ وعلامة المجانيّ ─────────────────────────────
  if position('        least(greatest(coalesce(nullif(e ->> ''discount_percent'','''')::numeric, 0), 0), 100) as disc_pct,' in v_new) = 0 then
    raise exception 'app_create_sales_invoice: تعذّر العثور على تعبير نسبة الخصم';
  end if;
  v_new := replace(v_new,
    '        least(greatest(coalesce(nullif(e ->> ''discount_percent'','''')::numeric, 0), 0), 100) as disc_pct,',
    replace('        case when coalesce(nullif(e ->> ''is_complimentary'','''')::boolean, false) then 0
             else least(greatest(coalesce(nullif(e ->> ''discount_percent'','''')::numeric, 0), 0), 100)
        end                                                                as disc_pct,
        -- خصمٌ بمبلغٍ إلى جانب النسبة: «بمئة ويدفع تسعين» عشرةُ ريالات لا نسبة
        case when coalesce(nullif(e ->> ''is_complimentary'','''')::boolean, false) then 0
             else greatest(coalesce(nullif(e ->> ''discount_amount'','''')::numeric, 0), 0)
        end                                                                as disc_amt,
        coalesce(nullif(e ->> ''is_complimentary'','''')::boolean, false)         as comp,', chr(13), ''));

  -- ── المربط ٥: حسابات السطر ──────────────────────────────────────────────
  if position(replace('      gq.qty, gq.price, gq.disc_pct, gq.exempt,
      round(gq.qty * gq.price, 2)                                   as line_subtotal,
      round(gq.qty * gq.price * gq.disc_pct / 100.0, 2)             as line_discount,
      round(gq.qty * gq.price, 2)
        - round(gq.qty * gq.price * gq.disc_pct / 100.0, 2)         as taxable,
      case when gq.exempt then 0
           else round((round(gq.qty * gq.price, 2)
                       - round(gq.qty * gq.price * gq.disc_pct / 100.0, 2))
                      * v_vat_rate / 100.0, 2) end                  as line_vat', chr(13), '') in v_new) = 0 then
    raise exception 'app_create_sales_invoice: تعذّر العثور على حسابات السطر';
  end if;
  v_new := replace(v_new,
    replace('      gq.qty, gq.price, gq.disc_pct, gq.exempt,
      round(gq.qty * gq.price, 2)                                   as line_subtotal,
      round(gq.qty * gq.price * gq.disc_pct / 100.0, 2)             as line_discount,
      round(gq.qty * gq.price, 2)
        - round(gq.qty * gq.price * gq.disc_pct / 100.0, 2)         as taxable,
      case when gq.exempt then 0
           else round((round(gq.qty * gq.price, 2)
                       - round(gq.qty * gq.price * gq.disc_pct / 100.0, 2))
                      * v_vat_rate / 100.0, 2) end                  as line_vat', chr(13), ''),
    replace('      gq.qty, gq.price, gq.disc_pct, gq.exempt, gq.disc_amt, gq.comp,
      round(gq.qty * gq.price, 2)                                   as line_subtotal,
      -- **بسقف مجموع السطر:** نسبةٌ ومبلغٌ معًا قد يتجاوزان المجموع فيخرج
      -- صافٍ سالب — وفاتورةٌ بصافٍ سالب تُفسد كل تقريرٍ يجمع.
      least(round(gq.qty * gq.price * gq.disc_pct / 100.0, 2) + gq.disc_amt,
            round(gq.qty * gq.price, 2))                            as line_discount,
      round(gq.qty * gq.price, 2)
        - least(round(gq.qty * gq.price * gq.disc_pct / 100.0, 2) + gq.disc_amt,
                round(gq.qty * gq.price, 2))                        as taxable,
      case when gq.exempt then 0
           else round((round(gq.qty * gq.price, 2)
                       - least(round(gq.qty * gq.price * gq.disc_pct / 100.0, 2) + gq.disc_amt,
                               round(gq.qty * gq.price, 2)))
                      * v_vat_rate / 100.0, 2) end                  as line_vat', chr(13), ''));

  if v_new = v_src then
    raise exception 'app_create_sales_invoice: لم يتغيّر شيء';
  end if;

  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- حرسٌ ختاميّ
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_src text;
begin
  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_create_sales_invoice'
   order by p.oid desc
   limit 1;
  if position('is_complimentary' in v_src) = 0
     or position('complimentary_reason' in v_src) = 0
     or position('discount_reason' in v_src) = 0
     or position('item_offers' in v_src) = 0
     or position('disc_amt' in v_src) = 0 then
    raise exception 'app_create_sales_invoice ما زالت لا تكتب المجانيّ أو الخصم المسبَّب أو تطبّق العرض';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0168_invoice_offer_complimentary_discount.sql
-- ---------------------------------------------------------------------------
