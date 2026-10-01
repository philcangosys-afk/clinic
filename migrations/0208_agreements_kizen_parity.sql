-- ============================================================================
-- 0208 — الاتفاقيات كما في Kizen: إلغاء المديونية، توقيع المريض، والتنبيهات
-- ============================================================================
--
-- ما يضيفه (طلب المالك 01/10/2026 «ابنِ النواقص»):
--
--   ١) «إلغاء المديونية» — منفصلٌ عن «معطّلة» كما في Kizen: يُسقط متبقّي
--      الاتفاقية من مطالبة المريض (تنبيه الاستقبال، منتقي المريض، بنود
--      الفوترة) **دون حذفها** ودون تعطيلها؛ ويُعاد بإلغائه.
--      صلاحيةٌ جديدة `agreements.cancel_debt` — لمدير الفرع افتراضًا (والمالك
--      والمدير بطبيعتهما)، بسببٍ مكتوب وسطر تدقيق.
--   ٢) توقيع المريض على الاتفاقية — صورة التوقيع (PNG) ووقته ومن أخذه، بسطر
--      تدقيق. يُطبع على الاتفاقية.
--   ٣) المنظورات الثلاثة تعرف «إلغاء المديونية»:
--        v_agreement_list           — أعمدةٌ تُضاف في آخره
--        v_agreement_billable_items — لا يُعرض للفوترة ما أُلغيت مديونيته
--        v_patient_open_agreements  — لا يدخل تنبيه الاستقبال ولا المنتقي
--
-- **لا يمسّ الفواتير ولا ZATCA:** لا دالّة فوترة ولا حارس سطر فاتورة ولا
-- ترقيم. «إشعار للاستقبال» يستعمل `app_send_follow_up_note` القائمة (0173)
-- بلا تغيير، وتقسيم البند يجري في عرض السعر بدالّة حفظه القائمة.
--
-- آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

-- ── ١) الأعمدة ──────────────────────────────────────────────────────────────
alter table treatment_agreements
  add column if not exists debt_cancelled     boolean not null default false,
  add column if not exists debt_cancel_reason text,
  add column if not exists debt_cancelled_at  timestamptz,
  add column if not exists debt_cancelled_by  uuid references auth.users(id),
  add column if not exists patient_signature  text,
  add column if not exists patient_signed_at  timestamptz,
  add column if not exists patient_signed_by  uuid references auth.users(id);

comment on column treatment_agreements.debt_cancelled is
  'أُلغيت مديونيتها (كـKizen): متبقّيها لا يُطالَب به ولا يُفوتَر، والاتفاقية باقية. 0208.';
comment on column treatment_agreements.patient_signature is
  'توقيع المريض على الاتفاقية — صورة PNG (data URL). 0208.';

-- ── ٢) الصلاحية ─────────────────────────────────────────────────────────────
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
values ('agreements.cancel_debt', 'إلغاء مديونية الاتفاقية', 'billing',
        'إسقاط متبقّي اتفاقيةٍ من مطالبة المريض دون حذفها، وإعادته — بسببٍ مكتوب.', 4134)
on conflict (permission_key) do nothing;

insert into role_default_permissions (role_key, permission_key)
values ('branch_manager', 'agreements.cancel_debt')
on conflict (role_key, permission_key) do nothing;

-- صفات المنشأة التي أساسها «مدير فرع»
insert into organization_role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'agreements.cancel_debt'
  from organization_roles r
 where r.base_role_key = 'branch_manager'
   and not r.is_archived
   and not exists (select 1 from organization_role_permissions x
                    where x.role_id = r.id and x.permission_key = 'agreements.cancel_debt');

-- ── ٣) إلغاء المديونية وإعادتها ─────────────────────────────────────────────
create or replace function app_set_agreement_debt_cancelled(
  p_agreement_id uuid,
  p_cancelled    boolean,
  p_reason       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_number bigint;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select organization_id, agreement_number into v_org, v_number
    from treatment_agreements where id = p_agreement_id;
  if v_org is null then raise exception 'الاتفاقية غير موجودة'; end if;
  if not app_has_permission(v_org, 'agreements.cancel_debt') then
    raise exception 'صلاحيتك لا تسمح بإلغاء مديونية الاتفاقيات (agreements.cancel_debt)';
  end if;
  if p_cancelled and v_reason is null then
    raise exception 'اكتب سبب إلغاء المديونية';
  end if;

  update treatment_agreements
     set debt_cancelled     = p_cancelled,
         debt_cancel_reason = case when p_cancelled then v_reason else null end,
         debt_cancelled_at  = case when p_cancelled then now() else null end,
         debt_cancelled_by  = case when p_cancelled then auth.uid() else null end,
         updated_by         = auth.uid(),
         updated_at         = now()
   where id = p_agreement_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_org, auth.uid(), 'billing', 'update', p_agreement_id,
          case when p_cancelled then 'إلغاء مديونية اتفاقية #' else 'إعادة مديونية اتفاقية #' end || v_number,
          v_reason);
end $$;

revoke all on function app_set_agreement_debt_cancelled(uuid, boolean, text) from public, anon;
grant execute on function app_set_agreement_debt_cancelled(uuid, boolean, text) to authenticated;

-- ── ٤) توقيع المريض ─────────────────────────────────────────────────────────
-- `p_signature` = null يمسح التوقيع (توقيعٌ خاطئ يُعاد)، وكلاهما بسطر تدقيق.
create or replace function app_sign_agreement(
  p_agreement_id uuid,
  p_signature    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_number bigint;
begin
  select organization_id, agreement_number into v_org, v_number
    from treatment_agreements where id = p_agreement_id;
  if v_org is null then raise exception 'الاتفاقية غير موجودة'; end if;
  if not app_has_permission(v_org, 'agreements.manage') then
    raise exception 'صلاحيتك لا تسمح بتوقيع الاتفاقيات (agreements.manage)';
  end if;
  if p_signature is not null then
    if p_signature not like 'data:image/png;base64,%' then
      raise exception 'التوقيع يجب أن يكون صورة PNG';
    end if;
    if length(p_signature) > 400000 then
      raise exception 'صورة التوقيع أكبر من المسموح';
    end if;
  end if;

  update treatment_agreements
     set patient_signature = p_signature,
         patient_signed_at = case when p_signature is null then null else now() end,
         patient_signed_by = case when p_signature is null then null else auth.uid() end,
         updated_by        = auth.uid(),
         updated_at        = now()
   where id = p_agreement_id;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_org, auth.uid(), 'billing', 'update', p_agreement_id,
          case when p_signature is null then 'مسح توقيع المريض على اتفاقية #' else 'توقيع المريض على اتفاقية #' end
            || v_number, null);
end $$;

revoke all on function app_sign_agreement(uuid, text) from public, anon;
grant execute on function app_sign_agreement(uuid, text) to authenticated;

-- ── ٥) المنظورات ────────────────────────────────────────────────────────────
-- (تعريفا 0193 كما هما، والإضافة في آخر الأعمدة / في الشرط)
create or replace view v_agreement_list
with (security_invoker = on) as
select
  a.id,
  a.organization_id,
  a.agreement_number,
  a.patient_id,
  p.name_ar                                    as patient_name,
  p.file_number,
  a.agreement_date,
  a.created_at,
  a.doctor_id,
  d.name_ar                                    as doctor_name,
  a.clinic_id,
  c.name                                       as clinic_name,
  a.registrar_id,
  dir.display_name                             as registrar_name,
  a.note,
  a.agreement_text,
  a.is_disabled,
  a.disabled_reason,
  s.services,
  coalesce(s.quotes_count, 0)                  as quotes_count,
  coalesce(s.gross, 0)                         as gross_amount,
  coalesce(s.discount, 0)                      as discount_amount,
  coalesce(s.vat, 0)                           as vat_amount,
  coalesce(s.net, 0)                           as net_amount,
  coalesce(s.invoiced, 0)                      as invoiced_amount,
  coalesce(s.net, 0) - coalesce(s.invoiced, 0) as remaining_amount,
  -- 0208: إلغاء المديونية وتوقيع المريض (الصورة نفسها لا تُحمَّل مع القائمة)
  a.debt_cancelled,
  a.debt_cancel_reason,
  a.debt_cancelled_at,
  a.patient_signed_at,
  (a.patient_signature is not null)            as has_patient_signature
from treatment_agreements a
join patients p on p.id = a.patient_id
left join doctors d on d.id = a.doctor_id
left join clinics c on c.id = a.clinic_id
left join v_organization_members_directory dir
       on dir.user_id = coalesce(a.registrar_id, a.created_by) and dir.organization_id = a.organization_id
left join lateral (
  select string_agg(distinct coalesce(ai.description, i.name_ar), '، ') as services,
         count(distinct ai.quote_id)            as quotes_count,
         sum(round(ai.qty * ai.unit_price, 2))  as gross,
         sum(ai.discount_amount)                as discount,
         sum(ai.vat_amount)                     as vat,
         sum(ai.net_amount)                     as net,
         sum(b.invoiced_amount)                 as invoiced
    from treatment_agreement_items ai
    left join agreement_quotes q on q.id = ai.quote_id
    left join items i on i.id = ai.item_id
    left join v_agreement_item_balances b on b.agreement_item_id = ai.id
   where ai.agreement_id = a.id
     and not coalesce(q.is_cancelled, false)
) s on true;;

grant select on v_agreement_list to authenticated;

create or replace view v_agreement_billable_items
with (security_invoker = on) as
select
  ai.id                                        as agreement_item_id,
  ai.agreement_id,
  a.organization_id,
  a.patient_id,
  a.agreement_number,
  ai.quote_id,
  q.quote_number,
  ai.item_id,
  coalesce(ai.description, i.name_ar)          as description,
  ai.qty,
  ai.unit_price,
  ai.discount_percent,
  ai.discount_amount,
  b.invoiced_qty,
  b.remaining_qty
from treatment_agreement_items ai
join treatment_agreements a on a.id = ai.agreement_id
left join agreement_quotes q on q.id = ai.quote_id
left join items i on i.id = ai.item_id
join v_agreement_item_balances b on b.agreement_item_id = ai.id
where not a.is_disabled
  and not a.debt_cancelled   -- 0208: ما أُلغيت مديونيته لا يُعرض للفوترة
  and not coalesce(q.is_cancelled, false)
  and ai.item_id is not null;;

grant select on v_agreement_billable_items to authenticated;

-- تنبيه الاستقبال ومنتقي المريض (0162): ما أُلغيت مديونيته لا يُطالَب به
create or replace view v_patient_open_agreements as
select
  ta.organization_id,
  ta.patient_id,
  count(*)                                        as open_count,
  coalesce(sum(coalesce(ta.remaining_amount, 0)), 0) as remaining_total
from treatment_agreements ta
where coalesce(ta.is_disabled, false) = false
  and coalesce(ta.debt_cancelled, false) = false
  and coalesce(ta.remaining_amount, 0) > 0
group by ta.organization_id, ta.patient_id;

alter view v_patient_open_agreements set (security_invoker = on);
revoke all on v_patient_open_agreements from anon;
grant select on v_patient_open_agreements to authenticated;

commit;

notify pgrst, 'reload schema';
