-- =============================================================================
-- 0153_consultation_follow_up.sql
-- قواعد الكشفية تُطبَّق فعلًا: المريض العائد داخل المدّة يُفوَّتر «مراجعة».
-- =============================================================================
--
-- **العيب:** `consultation_fee_rules` موجود منذ 0004 بكل حقوله — صنف الكشفية،
-- صنف المراجعة، مدّة التجديد، الأطباء، التخصّص — ولا يقرؤه إلّا
-- `app_auto_create_insurance_claim_form` ولغرضٍ واحد: هل الصنف كشفية أم لا.
-- فلا `renewal_days` يُقرأ، ولا `follow_up_item_id` يُستعمل، ولا `doctor_ids`
-- يُقيّد. النتيجة: **المريض العائد بعد أسبوع يُفوَّتر كشفية جديدة كاملة**،
-- والشاشة تقول «تلقائيًّا» عن شيءٍ لا يقع.
--
-- ومعه `consultation_fee_settings` — جدولٌ يُكتب إليه ولا تقرؤه دالّة ولا
-- منظور: `renewal_alert_enabled` مفتاحٌ بلا أثر، و`exempt_specialty_value_ids`
-- قائمةٌ لا تُستشار.
--
-- **قرار المالك:** المريض العائد داخل مدّة التجديد يُفوَّتر **صنف المراجعة**
-- بسعره — لا مجّانًا ولا بتحذيرٍ وحده.
--
-- **أين يقع الاستبدال ولماذا:** في الشاشة عند إضافة البند، لا في
-- `app_create_sales_invoice` عند الحفظ. الفاتورة يجب أن تطابق ما رآه المحاسب
-- وأقرّه: استبدالٌ صامت في القاعدة بعد أن قرأ «كشفية ٢٠٠» يُخرج فاتورةً
-- مطبوعة تخالف الشاشة. والقرار نفسه يبقى في القاعدة — الشاشة تسأل ولا تحكم،
-- فلا تُستنسخ القاعدة في الواجهة ولا تُغيَّر من المتصفّح.
--
-- **ما لا يزال غير مُطبَّق:** `free_reviews_count`. لم يطلبه المالك، ونصّ
-- الشاشة يقوله صراحةً بدل أن يوهم بأنّه يعمل.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- الصنف الذي يُفوتَر فعلًا: كشفية أم مراجعة؟
--
-- تُعيد صفًّا واحدًا دائمًا (ما لم يكن الصنف نفسه غير موجود في المنشأة)، فيها
-- الصنف واسمه وسعره وإعفاؤه الضريبيّ — فلا تحتاج الشاشة إلى استعلامٍ ثانٍ —
-- ومعها سببٌ عربيّ يُعرض للمحاسب. الصمت ليس خيارًا: استبدالٌ لا يُشرَح يبدو
-- خطأً في السعر.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_resolve_consultation_item(
  p_organization_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_doctor_id uuid default null,
  p_insurance_company_name text default null
)
returns table (
  item_id uuid,
  item_name text,
  item_price numeric,
  item_is_vat_exempt boolean,
  is_follow_up boolean,
  rule_id uuid,
  last_consultation_date date,
  renewal_days int,
  reason text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_enabled boolean := false;
  v_exempt  uuid[]  := '{}';
  v_spec    uuid;
  v_rule    consultation_fee_rules%rowtype;
  v_item    items%rowtype;
  v_follow  items%rowtype;
  v_last    date;
  v_days    int;
begin
  -- تقرأ تاريخ فواتير المريض، فلا تُنفَّذ إلّا لعضوٍ في المنشأة
  if not app_is_member(p_organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;

  select i.* into v_item
    from items i
   where i.id = p_item_id and i.organization_id = p_organization_id;
  if not found then
    -- صنفٌ ليس من هذه المنشأة: لا صفّ، والمستدعي يُبقي ما لديه
    return;
  end if;

  if p_patient_id is not null then
    select coalesce(s.renewal_alert_enabled, true), coalesce(s.exempt_specialty_value_ids, '{}')
      into v_enabled, v_exempt
      from consultation_fee_settings s
     where s.organization_id = p_organization_id;
    -- لا صفّ إعدادات = القاعدة مفعَّلة افتراضًا (الجدول يُنشأ عند أوّل حفظ)
    if not found then
      v_enabled := true;
      v_exempt  := '{}';
    end if;
  end if;

  if p_doctor_id is not null then
    select d.specialty_value_id into v_spec
      from doctors d
     where d.id = p_doctor_id and d.organization_id = p_organization_id;
  end if;

  if v_enabled and not (v_spec is not null and v_spec = any (v_exempt)) then
    -- الأخصّ يغلب: قاعدة الأطباء تسبق قاعدة شركة التأمين، وهي تسبق قاعدة
    -- التخصّص، وهي تسبق القاعدة العامّة. والمعرّف يفصل التعادل فلا يتغيّر
    -- المُنتقى بين نداءَين على البيانات نفسها.
    select r.* into v_rule
      from consultation_fee_rules r
     where r.organization_id = p_organization_id
       and r.is_disabled = false
       and r.consultation_item_id = p_item_id
       and r.follow_up_item_id is not null
       and (coalesce(cardinality(r.doctor_ids), 0) = 0
            or (p_doctor_id is not null and p_doctor_id = any (r.doctor_ids)))
       and (r.is_insurance_specific = false
            or (p_insurance_company_name is not null
                and btrim(lower(r.insurance_company_name)) = btrim(lower(p_insurance_company_name))))
       and (r.specialty_value_id is null or r.specialty_value_id = v_spec)
     order by (coalesce(cardinality(r.doctor_ids), 0) > 0) desc,
              r.is_insurance_specific desc,
              (r.specialty_value_id is not null) desc,
              r.renewal_days asc,
              r.id
     limit 1;
  end if;

  if v_rule.id is not null then
    -- تاريخ آخر **كشفية** لا آخر مراجعة: لو حُسبت المراجعة لتجدّدت المدّة مع
    -- كل زيارة ولما استحقّت كشفيةٌ جديدة أبدًا.
    -- والملغاة والمؤقّتة تُستبعَد: عرض سعر لم يُبَع لا يبدأ مدّة.
    select max(si.issued_at::date) into v_last
      from sales_invoices si
      join sales_invoice_items sii on sii.invoice_id = si.id
     where si.organization_id = p_organization_id
       and si.patient_id = p_patient_id
       and si.invoice_type = 'sale'
       and si.status <> 'void'
       and coalesce(si.is_temporary, false) = false
       and si.issued_at is not null
       and sii.item_id = v_rule.consultation_item_id;

    v_days := greatest(coalesce(v_rule.renewal_days, 30), 0);

    if v_last is not null and (current_date - v_last) < v_days then
      -- صنف المراجعة المؤرشف أو المعطَّل لا يُفوَّتر: يبقى الصنف الأصليّ
      -- ظاهرًا للمحاسب بدل سطرٍ بسعرٍ صفر لا يفهم من أين جاء.
      select i.* into v_follow
        from items i
       where i.id = v_rule.follow_up_item_id
         and i.organization_id = p_organization_id
         and i.is_archived = false
         and i.is_disabled = false;

      if found then
        return query select
          v_follow.id, v_follow.name_ar, v_follow.price, v_follow.is_vat_exempt,
          true, v_rule.id, v_last, v_days,
          format('مراجعة — آخر كشفية في %s (قبل %s يومًا، ومدّة التجديد %s يومًا)',
                 to_char(v_last, 'YYYY-MM-DD'),
                 (current_date - v_last)::text,
                 v_days::text);
        return;
      end if;
    end if;
  end if;

  return query select
    v_item.id, v_item.name_ar, v_item.price, v_item.is_vat_exempt,
    false, v_rule.id, v_last, v_days, ''::text;
end;
$$;

comment on function app_resolve_consultation_item(uuid, uuid, uuid, uuid, text) is
  'الصنف الذي يُفوتَر: كشفية أم مراجعة، بحسب قواعد الكشفية وتاريخ آخر كشفية للمريض. تُعيد صفًّا واحدًا مع سبب عربيّ يُعرض.';

revoke all on function app_resolve_consultation_item(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function app_resolve_consultation_item(uuid, uuid, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
