-- ============================================================================
-- 0232_correct_voucher_payment_method.sql — تصحيح طريقة الدفع على السند
-- ============================================================================
-- طلب المالك (05/10/2026): «إذا صدرت فاتورة ZATCA واخترت فيزا/ماستر بالخطأ
-- وفي الأصل هي مدى، هل هنالك طريقة للتعديل بدون لمس ZATCA؟» — وأن تكون في
-- الفاتورة نفسها.
--
-- طريقة الدفع لا تدخل مستند ZATCA للفاتورة العادية (لا PaymentMeans فيه) —
-- تعيش في سند القبض وحده. فالتصحيح يمسّ `financial_vouchers` لا الفاتورة:
--
--   • سببٌ إلزاميّ، وسطرٌ في سجلّ التدقيق بالطريقة القديمة والجديدة.
--   • بين طريقتين لا تمسّان درج النقد (مدى ↔ فيزا ↔ تحويل…) يُسمح دائمًا:
--     جرد الصندوق لا يتغيّر.
--   • ما يمسّ النقد (نقدي ↔ بطاقة) يُرفض إن كانت مناوبة الصندوق مُقفلة أو
--     اليومية مُقفلة — الجرد اعتُمد على أساسه، والتصحيح حينها بإلغاء السند
--     وسندٍ جديد في المناوبة المفتوحة.
--   • لا يُصحَّح سندٌ ملغى.
-- آمنة للتكرار.
-- ============================================================================

begin;

create or replace function public.app_correct_voucher_payment_method(
  p_voucher_id              uuid,
  p_payment_method_value_id uuid,
  p_reason                  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_v        public.financial_vouchers%rowtype;
  v_old_name text;
  v_new_name text;
  v_old_cash boolean;
  v_new_cash boolean;
  v_shift    text;
  v_day_closed boolean;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;

  select * into v_v from public.financial_vouchers where id = p_voucher_id for update;
  if v_v.id is null then raise exception 'السند غير موجود'; end if;
  if not public.app_is_member(v_v.organization_id) then
    raise exception 'لا تملك صلاحية على هذه المنشأة';
  end if;
  if not (public.app_has_permission(v_v.organization_id, 'billing.issue')
          or public.app_has_permission(v_v.organization_id, 'billing.void')) then
    raise exception 'صلاحيتك لا تسمح بتصحيح سندات القبض';
  end if;
  if coalesce(v_v.is_void, false) then raise exception 'السند ملغى — لا يُصحَّح'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'اكتب سبب التصحيح';
  end if;
  if p_payment_method_value_id is null then raise exception 'اختر طريقة الدفع الصحيحة'; end if;
  if v_v.payment_method_value_id is not distinct from p_payment_method_value_id then
    raise exception 'طريقة الدفع المختارة هي نفسها المسجَّلة';
  end if;

  select lv.name_ar,
         coalesce((lv.extra ->> 'affects_drawer')::boolean, lv.code = 'cash', false)
    into v_new_name, v_new_cash
    from public.lookup_values lv
    join public.lookup_categories c on c.id = lv.category_id
   where lv.id = p_payment_method_value_id
     and c.key = 'payment_methods'
     and not coalesce(lv.is_disabled, false)
     and (c.organization_id is null or c.organization_id = v_v.organization_id);
  if v_new_name is null then raise exception 'طريقة الدفع غير موجودة أو معطّلة'; end if;

  select lv.name_ar,
         coalesce((lv.extra ->> 'affects_drawer')::boolean, lv.code = 'cash', false)
    into v_old_name, v_old_cash
    from public.lookup_values lv
   where lv.id = v_v.payment_method_value_id;

  -- ما يمسّ درج النقد لا يُصحَّح بعد إقفال الجرد
  if coalesce(v_old_cash, false) <> coalesce(v_new_cash, false) then
    if v_v.cash_shift_id is not null then
      select status into v_shift from public.cash_register_shifts where id = v_v.cash_shift_id;
      if coalesce(v_shift, 'open') <> 'open' then
        raise exception 'التصحيح بين النقد والبطاقة يغيّر جرد مناوبةٍ مُقفلة — ألغِ السند وسجّل دفعةً جديدة في المناوبة المفتوحة';
      end if;
    end if;
    if v_v.business_day_id is not null then
      select closed_at is not null into v_day_closed from public.business_days where id = v_v.business_day_id;
      if coalesce(v_day_closed, false) then
        raise exception 'التصحيح بين النقد والبطاقة يغيّر يوميةً مُقفلة — ألغِ السند وسجّل دفعةً جديدة';
      end if;
    end if;
  end if;

  update public.financial_vouchers
     set payment_method_value_id = p_payment_method_value_id
   where id = v_v.id;

  insert into public.audit_log (organization_id, branch_id, user_id, module, action_type,
                                entity_id, entity_title, details, reason)
  values (v_v.organization_id, v_v.branch_id, auth.uid(), 'billing', 'update', v_v.id,
          'تصحيح طريقة الدفع — سند ' || coalesce(v_v.voucher_number::text, ''),
          format('%s ← %s · المبلغ %s', coalesce(v_old_name, 'غير محدَّدة'), v_new_name, v_v.amount),
          btrim(p_reason));
end $$;

revoke all on function public.app_correct_voucher_payment_method(uuid, uuid, text) from public, anon;
grant execute on function public.app_correct_voucher_payment_method(uuid, uuid, text) to authenticated;

comment on function public.app_correct_voucher_payment_method(uuid, uuid, text) is
  'تصحيح طريقة الدفع على سند قبض/استرداد بسبب وتدقيق — لا يمسّ الفاتورة ولا ZATCA. ما يمسّ النقد يُمنع بعد إقفال المناوبة أو اليومية. 0232.';

commit;

notify pgrst, 'reload schema';

select 'تصحيح طريقة الدفع' as "البند",
       case when to_regprocedure('public.app_correct_voucher_payment_method(uuid,uuid,text)') is not null
            then 'جاهزة' else 'مفقودة' end as "الحالة";
