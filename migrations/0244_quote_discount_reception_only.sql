-- ============================================================================
-- 0244_quote_discount_reception_only.sql — الخصم على عرض السعر للاستقبال والمالك
-- ============================================================================
-- طلب المالك (14/10/2026): «في عرض السعر التابع للاتفاقية: الأطباء لا يستطيعون
-- عمل أو كتابة خصم — هذه الخاصية والتعديل عليها عند الاستقبال والمالك».
--
-- القاعدة تفرضه لا الشاشة وحدها: في `app_save_agreement_quote` بعد حساب خصم
-- كلّ سطر، من ليس مالكًا ولا مدير منشأة ولا استقبالًا:
--   • على سطرٍ محفوظ: لا يتغيّر خصمه — يُقبل إن بقي مبلغه أو بقيت نسبته كما
--     هي (فتغيير العدد أو السعر مع خصمٍ قائم لا يُرفض).
--   • على سطرٍ جديد: لا خصم إلّا الخصم الافتراضيّ للخدمة من الكتالوج
--     (`items.default_discount_percent`) — قرار الإدارة لا الطبيب.
--
-- يُرقَّع نصّ الدالّة الحيّ (pg_get_functiondef) لا نصّ الملفّ، وتفشل الترقية
-- صراحةً إن لم يُطابق الموضع. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

do $$
declare
  v_src    text;
  v_new    text;
  v_anchor constant text := 'v_pct  := case when v_gross > 0 then round(v_disc / v_gross * 100.0, 2) else 0 end;';
  v_block  constant text := $blk$v_pct  := case when v_gross > 0 then round(v_disc / v_gross * 100.0, 2) else 0 end;

    -- 0244: الخصم للمالك ومدير المنشأة والاستقبال وحدهم (قرار المالك 14/10/2026)
    if not app_has_role(v_a.organization_id, array['owner', 'organization_admin', 'receptionist']) then
      if v_line_id is not null then
        if exists (select 1 from treatment_agreement_items x0244
                    where x0244.id = v_line_id
                      and abs(coalesce(x0244.discount_amount, 0) - v_disc) > 0.01
                      and abs(coalesce(x0244.discount_percent, 0) - v_pct) > 0.01) then
          raise exception 'السطر % («%»): تعديل الخصم للاستقبال والإدارة — اترك الخصم كما هو', v_idx, v_item.name_ar;
        end if;
      elsif v_disc > 0
            and abs(v_pct - coalesce(v_item.default_discount_percent, 0)) > 0.01 then
        raise exception 'السطر % («%»): الخصم للاستقبال والإدارة — أضف الخدمة بلا خصم', v_idx, v_item.name_ar;
      end if;
    end if;$blk$;
begin
  select pg_get_functiondef('public.app_save_agreement_quote(uuid,uuid,uuid,uuid,timestamptz,text,jsonb)'::regprocedure)
    into v_src;
  v_src := replace(v_src, chr(13), '');

  if position('0244: الخصم للمالك' in v_src) > 0 then
    raise notice '0244 مطبّقة سلفًا — لا تغيير';
    return;
  end if;

  if (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'تعذّر ترقيع app_save_agreement_quote — موضع حساب نسبة الخصم تغيّر';
  end if;

  v_new := replace(v_src, v_anchor, v_block);
  execute v_new;
  raise notice '0244 ✓ الخصم على عروض الأسعار للاستقبال والإدارة';
end $$;

commit;
