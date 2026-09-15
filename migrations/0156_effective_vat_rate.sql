-- =============================================================================
-- 0156_effective_vat_rate.sql
-- نسبة الضريبة السارية — مصدرٌ واحد للشاشة وللدالّة.
-- =============================================================================
--
-- **العطل الذي تُغلقه، بالأرقام:**
--
-- فاتورة المريضة «بشائر» (سعودية، هويتها مُثبَتة): بندٌ واحد بـ١٢٠ ر.س.
--   • الشاشة عرضت: فرعيّ ١٢٠ + ضريبة ١٨ = صافي ١٣٨، وأرسلت دفعةً بـ١٣٨.
--   • القاعدة حسبت: المريضة معفاة بجنسيتها ← ضريبة صفر ← صافي ١٢٠.
--   • `app_receive_invoice_payment` رفضت: «المبلغ 138.00 يتجاوز المتبقّي 120.00».
--
-- فلم تُحفظ الفاتورة أصلًا — وكل فاتورة لمريضٍ سعوديّ مع دفعةٍ كاملة تفشل
-- الفشل نفسه. والقاعدة كانت مُحقّة: الإعفاء قرار المالك، والشاشة هي المخطئة.
--
-- **السبب الجذريّ:** للضريبة تعريفان. الواجهة تحسبها من
-- `organizations.default_vat_rate ?? 15`، و`app_create_sales_invoice` تحسبها
-- من ثلاثة مصادر لا تراها الواجهة: تفعيل الضريبة في
-- `organization_vat_settings`، وإعفاء الجنسية، وكون `default_vat_rate`
-- الفارغة تعني صفرًا لا ١٥. وتعليق الدالّة نفسه يقول إنّها «تتجاهل ما يرسله
-- العميل من إجماليات» — فحين يفترق التعريفان لا تُحفظ الفاتورة، والرسالة لا
-- تشرح لماذا.
--
-- **الحلّ:** لا يُنسَخ المنطق في الواجهة — تُسأل القاعدة. هذه الدالّة تُعيد
-- **النسبة التي ستطبّقها `app_create_sales_invoice` فعلًا**، بنفس ترتيب
-- الفحوص وبنفس الشروط، فيستحيل الاختلاف.
--
-- وتُعيد معها ما يشرح الرقم للصرّاف (سبب الإعفاء)، وما يمنع مفاجأةً أخرى
-- عند الحفظ (`block_invoice_without_nationality_or_id` — إعدادٌ ترفض به
-- الدالّة الفاتورة، وكانت الشاشة تكتشفه بعد أن يُدخل الصرّاف كل شيء).
--
-- إضافةٌ محضة: دالّة قراءة واحدة. لا جدول يتغيّر ولا دالّة قائمة تُمسّ.
-- =============================================================================

create or replace function app_effective_vat_rate(
  p_organization_id uuid,
  p_patient_id uuid default null
)
returns table (
  vat_rate       numeric,
  patient_exempt boolean,
  exempt_reason  text,
  blocked        boolean,
  block_reason   text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rate     numeric;
  v_settings organization_vat_settings%rowtype;
  v_enabled  boolean;
  v_nat      uuid;
  v_id_num   text;
  v_nat_name text;
  v_exempt   boolean := false;
  v_reason   text;
  v_blocked  boolean := false;
  v_block    text;
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;

  -- ── نفس ترتيب الفحوص في `app_create_sales_invoice` قسم (ج) ───────────────
  --
  -- `default_vat_rate` الفارغة تعني **صفرًا** لا ١٥. الواجهة كانت تضع ١٥
  -- بـ`?? 15`، فمنشأةٌ لم تُضبط نسبتها بعد كانت تعرض ضريبةً لا تُحتسب.
  select o.default_vat_rate into v_rate
    from organizations o where o.id = p_organization_id;
  select * into v_settings
    from organization_vat_settings s where s.organization_id = p_organization_id;

  v_enabled := coalesce(v_settings.sales_vat_enabled, true);
  v_rate    := coalesce(v_rate, 0);

  if not v_enabled then
    v_rate   := 0;
    v_reason := 'ضريبة المبيعات معطَّلة في إعدادات المنشأة';
  end if;

  if p_patient_id is not null then
    select p.nationality_value_id, nullif(btrim(coalesce(p.id_number, '')), '')
      into v_nat, v_id_num
      from patients p
     where p.id = p_patient_id
       and p.organization_id = p_organization_id;

    -- المريض من منشأةٍ أخرى: لا يُخمَّن له إعفاء، ويُترك للدالّة أن ترفض
    if not found then
      return query select v_rate, false, v_reason, false, null::text;
      return;
    end if;

    -- المنع بلا جنسية/هوية — تكتشفه الشاشة قبل الإدخال لا بعده
    if coalesce(v_settings.block_invoice_without_nationality_or_id, false)
       and (v_nat is null or v_id_num is null) then
      v_blocked := true;
      v_block   := 'الفاتورة تتطلّب جنسية ورقم هوية في ملفّ المريض — أكملهما في الملفّ ثم أعد الإصدار';
    end if;

    -- الإعفاء يشترط الهوية لا الجنسية وحدها: هو إعفاء مواطنٍ مُثبَتة هويته
    if v_nat is not null
       and v_settings.vat_exempt_nationality_value_ids is not null
       and v_nat = any (v_settings.vat_exempt_nationality_value_ids)
       and not coalesce(v_settings.vat_exemption_disabled_for_customer_types, false)
       and (not coalesce(v_settings.vat_exempt_requires_id, true) or v_id_num is not null)
    then
      v_exempt := true;
      v_rate   := 0;
      select lv.name_ar into v_nat_name from lookup_values lv where lv.id = v_nat;
      v_reason := 'المريض معفى من الضريبة بجنسيته (' || coalesce(v_nat_name, '—') || ')';
    end if;
  end if;

  return query select v_rate, v_exempt, v_reason, v_blocked, v_block;
end;
$$;

comment on function app_effective_vat_rate(uuid, uuid) is
  'نسبة الضريبة التي ستطبّقها app_create_sales_invoice فعلًا على فاتورة هذا المريض، وسبب الإعفاء إن وُجد، والمنع إن اشترطت الإعدادات جنسيةً وهوية. تُسألها الشاشة بدل أن تحسب النسبة بنفسها.';

revoke all on function app_effective_vat_rate(uuid, uuid) from public, anon;
grant execute on function app_effective_vat_rate(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
