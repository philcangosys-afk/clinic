-- ---------------------------------------------------------------------------
-- 0170 — الطبيب يُصدر فاتورة مريضه، والاستقبال يرى ما أعطاه
--
-- المطلوب: «المريض يدخل للطبيب، والطبيب هو يصدر الفاتورة، وتظهر في الاستقبال
-- لنرى كم أعطاه الطبيب الخدمة — مثلًا بمئة والمريض سيدفع تسعين».
--
-- والحال الآن أنّ `app_create_sales_invoice` تفحص الدور فتسمح لـ
-- (owner, organization_admin, branch_manager, accountant, receptionist)
-- **والطبيب ليس فيها** — أي أنّ الميزة مستحيلة لا ناقصة: أيّ زرٍّ يُضاف في
-- شاشة الطبيب يُرفَض من القاعدة برسالة «صلاحيتك لا تسمح بإصدار الفواتير».
--
-- وهذه الترقية تفتح البابَ بقيودٍ أربعة، وكلٌّ منها يمنع ضررًا بعينه:
--
--   (١) **بصلاحيةٍ مستقلّة** `billing.doctor_invoice` لا بالدور وحده. ليس كل
--       طبيبٍ في كل منشأة يُفوتِر، والفتح للدور كلّه قرارٌ لا يملكه من كتب
--       الترقية.
--
--   (٢) **لمريضه هو.** الطبيب يُفوتِر مَن هو طبيبه المعالج أو مَن شارك في
--       علاجه أو مَن له معه موعدٌ أو زيارة — وهو تعريف `v_doctor_patients`
--       نفسه المستعمل في شاشتَي المرضى والمواعيد (0164). فلا تعريفان.
--
--   (٣) **باسمه هو.** فاتورةٌ يُصدرها طبيبٌ وينسبها إلى طبيبٍ آخر تُحوّل
--       الإيراد والعمولة إلى غيره. فـ`p_doctor_id` يُلزَم بأن يكون هو.
--
--   (٤) **ولا يقبض مالًا.** `p_payments` تُرفض للطبيب: هو يُصدر والاستقبال
--       يُحصّل. وسندُ قبضٍ من غرفة الطبيب بلا صندوقٍ ولا مناوبة يُخرج المال
--       من الجرد كلّه — وهو الباب الذي يُفتَح مرّةً فلا يُغلَق.
--
-- والإداريّ (owner/organization_admin) يبقى فوق هذه القيود: هو يُفوتِر لأيّ
-- طبيب وأيّ مريض كما كان.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) الصلاحية
-- ═══════════════════════════════════════════════════════════════════════════
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
select v.k, v.n, 'billing', v.d, v.o
from (values
  ('billing.doctor_invoice', 'إصدار الطبيب للفاتورة', 'الطبيب يُصدر فاتورة مريضه من شاشته، ويُحصّلها الاستقبال', 2380)
) as v(k, n, d, o)
where not exists (select 1 from permission_catalog c where c.permission_key = v.k);

-- **لا تُمنح افتراضيًّا لأحد.** من أراد أن يُفوتِر أطباؤه يمنحها من شاشة
-- الصلاحيات — وفتحها للدور كلّه من ترقيةٍ قرارٌ ماليّ لا يملكه المطوّر.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) `app_create_sales_invoice` تقبل الطبيب بشروطه
-- ═══════════════════════════════════════════════════════════════════════════
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
    raise exception 'app_create_sales_invoice غير موجودة';
  end if;
  v_src := replace(v_src, chr(13), '');

  if position('billing.doctor_invoice' in v_src) > 0 then
    return; -- مُرقَّعة سلفًا
  end if;

  if position(replace('  if not app_has_role(p_organization_id,
        array[''owner'',''organization_admin'',''branch_manager'',''accountant'',''receptionist'']) then
    raise exception ''صلاحيتك لا تسمح بإصدار الفواتير'';
  end if;', chr(13), '') in v_src) = 0 then
    raise exception 'app_create_sales_invoice: تعذّر العثور على فحص الدور';
  end if;

  v_new := replace(v_src,
    replace('  if not app_has_role(p_organization_id,
        array[''owner'',''organization_admin'',''branch_manager'',''accountant'',''receptionist'']) then
    raise exception ''صلاحيتك لا تسمح بإصدار الفواتير'';
  end if;', chr(13), ''),
    replace('  if not app_has_role(p_organization_id,
        array[''owner'',''organization_admin'',''branch_manager'',''accountant'',''receptionist'']) then
    -- ── الطبيب: بصلاحيةٍ مستقلّة، ولمريضه، وباسمه، وبلا قبضِ مال (0170) ──
    if not (app_has_role(p_organization_id, array[''doctor''])
            and app_has_permission(p_organization_id, ''billing.doctor_invoice'')) then
      raise exception ''صلاحيتك لا تسمح بإصدار الفواتير'';
    end if;

    select d.id into v_self_doctor
      from doctors d
     where d.organization_id = p_organization_id
       and d.user_id = auth.uid()
       and coalesce(d.is_enabled, true) = true
     limit 1;
    if v_self_doctor is null then
      raise exception ''حسابك غير مربوط ببطاقة طبيب في هذه المنشأة — اربطه من شاشة الأطباء'';
    end if;

    if p_doctor_id is not null and p_doctor_id <> v_self_doctor then
      raise exception ''لا تُصدر فاتورةً باسم طبيبٍ آخر'';
    end if;
    p_doctor_id := v_self_doctor;

    if p_patient_id is null then
      raise exception ''فاتورة الطبيب تكون لمريضٍ في النظام لا لعميلٍ خارجيّ'';
    end if;
    if not exists (
      select 1 from v_doctor_patients vp
       where vp.doctor_id = v_self_doctor
         and vp.id = p_patient_id
         and vp.organization_id = p_organization_id
    ) then
      raise exception ''هذا المريض ليس من مرضاك — لا طبيبًا معالجًا ولا مشاركًا ولا له معك موعدٌ أو زيارة'';
    end if;

    -- **يُصدر ولا يقبض.** التحصيل في الاستقبال بصندوقٍ ومناوبةٍ مفتوحة.
    if p_payments is not null and jsonb_typeof(p_payments) = ''array''
       and jsonb_array_length(p_payments) > 0 then
      raise exception ''الطبيب يُصدر الفاتورة ولا يُحصّلها — التحصيل من الاستقبال'';
    end if;
  end if;', chr(13), ''));

  if v_new = v_src then
    raise exception 'app_create_sales_invoice: لم يتغيّر شيء';
  end if;

  -- المتغيّر الجديد يُعلَن مع بقيّة الإعلانات
  if position('  v_offer_credit numeric(14,2) := 0;' in v_new) = 0 then
    raise exception 'app_create_sales_invoice: تعذّر العثور على كتلة الإعلانات';
  end if;
  v_new := replace(v_new,
    '  v_offer_credit numeric(14,2) := 0;',
    replace('  v_offer_credit numeric(14,2) := 0;
  v_self_doctor  uuid;', chr(13), ''));

  execute v_new;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) ما أصدره الأطباء — منظور الاستقبال
--
-- «كم أعطاه الطبيب» سؤالٌ عن الخصم لا عن الإجمالي: خدمةٌ بمئة والمريض يدفع
-- تسعين. فالمنظور يُظهر المُعلَن والمخصوم والصافي والمجانيّ في صفٍّ واحد،
-- وبمن أصدرها — ليكون التحصيل على بيّنة لا على ورقةٍ بيد المريض.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_doctor_issued_invoices as
select
  s.id,
  s.organization_id,
  s.invoice_number,
  s.patient_id,
  p.name_ar                         as patient_name,
  p.file_number,
  s.doctor_id,
  d.name_ar                         as doctor_name,
  s.appointment_id,
  s.visit_id,
  s.status,
  s.is_temporary,
  s.created_at,
  s.issued_at,
  -- المُعلَن قبل أيّ خصم: مجموع (السعر × الكمية) على السطور
  round(coalesce(sum(li.price * li.qty), 0), 2)            as gross_amount,
  round(coalesce(sum(li.discount_amount), 0), 2)           as discount_total,
  s.net_amount,
  s.paid_amount,
  round(greatest(coalesce(s.net_amount, 0) - coalesce(s.paid_amount, 0), 0), 2)
                                                           as remaining_amount,
  count(*) filter (where li.is_complimentary)              as complimentary_count,
  -- قيمة ما تُنازلت عنه المنشأة مجانًا بسعر القائمة
  round(coalesce(sum(case when li.is_complimentary
                          then coalesce(i.price, 0) * coalesce(li.qty, 1)
                          else 0 end), 0), 2)              as complimentary_value,
  -- أسباب الخصم مجموعةً: الاستقبال يقرأ «لماذا» لا «كم» فقط
  nullif(string_agg(distinct li.discount_reason, ' · ')
         filter (where coalesce(li.discount_amount, 0) > 0), '') as discount_reasons,
  nullif(string_agg(distinct li.complimentary_reason, ' · ')
         filter (where li.is_complimentary), '')                 as complimentary_reasons,
  dir.display_name                  as issued_by_name
from sales_invoices s
join sales_invoice_items li on li.invoice_id = s.id
left join patients p on p.id = s.patient_id
left join doctors  d on d.id = s.doctor_id
left join items    i on i.id = li.item_id
left join v_organization_members_directory dir
       on dir.user_id = s.created_by
      and dir.organization_id = s.organization_id
where s.doctor_id is not null
  and s.invoice_type = 'sale'
group by s.id, s.organization_id, s.invoice_number, s.patient_id, p.name_ar,
         p.file_number, s.doctor_id, d.name_ar, s.appointment_id, s.visit_id,
         s.status, s.is_temporary, s.created_at, s.issued_at, s.net_amount,
         s.paid_amount, dir.display_name;

alter view v_doctor_issued_invoices set (security_invoker = on);
revoke all on v_doctor_issued_invoices from anon;
grant select on v_doctor_issued_invoices to authenticated;

comment on view v_doctor_issued_invoices is
  'فواتير الأطباء بصفٍّ واحد: المُعلَن والمخصوم وسببه والمجانيّ وقيمته والمتبقّي — يقرؤها الاستقبال ليرى ما أعطاه الطبيب.';

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
  if position('billing.doctor_invoice' in v_src) = 0
     or position('v_doctor_patients' in v_src) = 0
     or position('لا يُحصّلها' in v_src) = 0 then
    raise exception 'app_create_sales_invoice لم تقبل الطبيب بشروطه';
  end if;
  if pg_get_viewdef('v_doctor_issued_invoices'::regclass, true) ilike '%auth.users%' then
    raise exception 'v_doctor_issued_invoices يقرأ auth.users';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- بعد التشغيل
--
--   امنح `billing.doctor_invoice` لمن تريد من الأطباء من شاشة الصلاحيات،
--   واربط حساب كل طبيب ببطاقته (`doctors.user_id`) — بلا الربط يرفض النظام
--   الإصدار برسالةٍ صريحة لا بصمت.
-- ---------------------------------------------------------------------------
