-- ============================================================================
-- 0245_doctor_documents_and_discount_limit.sql
--   رفع المستندات للأطباء · وخصم الطبيب على عروض الأسعار بصلاحيةٍ وحدٍّ أقصى
-- ============================================================================
-- طلبا المالك (18/10/2026):
--
-- ١) «فعّل للأطباء رفع الصور والمستندات في ملفّات المرضى (المستندات)».
--    الزرّ والقاعدة يسألان `documents.upload`. الطبيب يملكها افتراضًا منذ 0102،
--    لكنّ صفة «طبيب» المعدّلة لهذه المنشأة (0201) أو الأدوار المخصّصة المبنيّة
--    عليها لا تحملها، فيُضاف المفتاح (ومعه `documents.view`) إلى:
--      • افتراض الصفة `role_default_permissions`
--      • كلّ صفةٍ/دورٍ في المنشآت أساسه «طبيب» `organization_role_permissions`
--      • ويُرفع المنع الفرديّ عن الأطباء في `membership_permissions` إن وُجد.
--
-- ٢) «أعِد الخصم للأطباء في عرض سعر الاتفاقية، وأقصاه 30٪، كصلاحيةٍ تُمنح في
--    إدارة الصلاحيات وتُعدَّل نسبتها، ويمنحها المالك».
--    • صلاحية جديدة `agreements.discount` «خصم على عروض أسعار الاتفاقيات» في
--      قسم الاتفاقيات — تُمنح وتُسحب من «الأدوار والصلاحيات» كأيّ صلاحية.
--    • النسبة القصوى من الجدول القائم `discount_limits` (لا جدول جديد):
--      حدّ المستخدم، وإلّا حدّ دوره المخصّص، وإلّا حدّ صفته. وتُضبط لصفة
--      «طبيب» 30٪ الآن، وتُعدَّل من نافذة صلاحيات الصفة نفسها.
--    • `app_save_agreement_quote`: المالك ومدير المنشأة والاستقبال بلا حدّ
--      (كما في 0244)؛ وغيرهم يغيّر الخصم إن مُنح الصلاحية وفي حدود نسبته،
--      وإلّا يُرفض كما في 0244. الخصم الافتراضيّ للخدمة من الكتالوج يمرّ دائمًا.
--    • تُستبدل رقعة 0244 إن طُبّقت، وإلّا تُضاف في موضعها. نصّ الدالّة الحيّ
--      هو ما يُرقَّع، وتفشل الترقية صراحةً إن لم يُطابق الموضع.
--
-- آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── ١) رفع المستندات للأطباء ────────────────────────────────────────────────
insert into role_default_permissions (role_key, permission_key)
select 'doctor', k.key
  from (values ('documents.view'), ('documents.upload')) as k(key)
 where not exists (select 1 from role_default_permissions x
                    where x.role_key = 'doctor' and x.permission_key = k.key);

insert into organization_role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, k.key
  from organization_roles r
 cross join (values ('documents.view'), ('documents.upload')) as k(key)
 where r.base_role_key = 'doctor'
   and not r.is_archived
   and not exists (select 1 from organization_role_permissions x
                    where x.role_id = r.id and x.permission_key = k.key);

update membership_permissions mp
   set granted = true
  from organization_memberships m
 where m.organization_id = mp.organization_id
   and m.user_id = mp.user_id
   and m.role_key = 'doctor'
   and mp.permission_key in ('documents.view', 'documents.upload')
   and not mp.granted;

-- ── ٢أ) صلاحية الخصم على عروض الأسعار ──────────────────────────────────────
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
values ('agreements.discount', 'خصم على عروض أسعار الاتفاقيات', 'agreements',
        'كتابة الخصم وتعديله في عرض السعر حتى النسبة القصوى للصفة أو الدور (حدود الخصم). المالك ومدير المنشأة والاستقبال بلا حدّ.',
        2215)
on conflict (permission_key) do nothing;

insert into role_default_permissions (role_key, permission_key)
select k.role_key, 'agreements.discount'
  from (values ('doctor'), ('receptionist')) as k(role_key)
 where not exists (select 1 from role_default_permissions x
                    where x.role_key = k.role_key and x.permission_key = 'agreements.discount');

insert into organization_role_permissions (organization_id, role_id, permission_key)
select r.organization_id, r.id, 'agreements.discount'
  from organization_roles r
 where r.base_role_key in ('doctor', 'receptionist')
   and not r.is_archived
   and not exists (select 1 from organization_role_permissions x
                    where x.role_id = r.id and x.permission_key = 'agreements.discount');

-- حدّ الطبيب 30٪ لكلّ منشأة فيها أطباء (يُحدَّث إن وُجد حدٌّ لصفة الطبيب)
update discount_limits
   set max_percent = 30
 where applies_to_role = 'doctor'
   and applies_to_user_id is null;

insert into discount_limits (organization_id, applies_to_role, applies_to_user_id, min_percent, max_percent)
select distinct m.organization_id, 'doctor', null::uuid, 0, 30
  from organization_memberships m
 where m.role_key = 'doctor'
   and not exists (select 1 from discount_limits d
                    where d.organization_id = m.organization_id
                      and d.applies_to_role = 'doctor'
                      and d.applies_to_user_id is null);

-- ── ٢ب) الحدّ الساري للمستخدم الداخل ────────────────────────────────────────
-- المستخدم، ثمّ دوره المخصّص (`applies_to_role` = معرّف الدور)، ثمّ صفته.
-- لا حدّ = null (لا قيد بالنسبة).
create or replace function public.app_discount_limit(p_organization_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select max(d.max_percent) from discount_limits d
      where d.organization_id = p_organization_id
        and d.applies_to_user_id = auth.uid()),
    (select max(d.max_percent) from discount_limits d
       join organization_memberships m
         on m.organization_id = d.organization_id and m.user_id = auth.uid() and m.is_active
      where d.organization_id = p_organization_id
        and d.applies_to_user_id is null
        and m.custom_role_id is not null
        and d.applies_to_role = m.custom_role_id::text),
    (select max(d.max_percent) from discount_limits d
       join organization_memberships m
         on m.organization_id = d.organization_id and m.user_id = auth.uid() and m.is_active
      where d.organization_id = p_organization_id
        and d.applies_to_user_id is null
        and d.applies_to_role = m.role_key)
  );
$$;

revoke all on function public.app_discount_limit(uuid) from public, anon;
grant execute on function public.app_discount_limit(uuid) to authenticated;

comment on function public.app_discount_limit(uuid) is
  'أقصى نسبة خصم للمستخدم الداخل من discount_limits: المستخدم ثمّ الدور المخصّص ثمّ الصفة؛ null = بلا حدّ. 0245.';

-- ── ٢ج) ضبط حدّ صفةٍ أو دور من «الأدوار والصلاحيات» ─────────────────────────
-- `p_role_ref`: مفتاح الصفة (doctor…) أو معرّف الدور المخصّص. null = بلا حدّ.
create or replace function public.app_set_role_discount_limit(
  p_organization_id uuid,
  p_role_ref        text,
  p_max_percent     numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_organization_id, 'users.permissions') then
    raise exception 'صلاحيتك لا تسمح بإدارة الأدوار (users.permissions)';
  end if;
  if coalesce(btrim(p_role_ref), '') = '' then
    raise exception 'حدّد الصفة أو الدور';
  end if;
  if p_max_percent is not null and (p_max_percent < 0 or p_max_percent > 100) then
    raise exception 'النسبة القصوى من 0 إلى 100';
  end if;

  delete from discount_limits
   where organization_id = p_organization_id
     and applies_to_role = btrim(p_role_ref)
     and applies_to_user_id is null;

  if p_max_percent is not null then
    insert into discount_limits (organization_id, applies_to_role, applies_to_user_id, min_percent, max_percent)
    values (p_organization_id, btrim(p_role_ref), null, 0, round(p_max_percent, 2));
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_title, details)
  values (p_organization_id, auth.uid(), 'users', 'update',
          'حدّ الخصم على عروض الأسعار',
          format('%s ← %s', btrim(p_role_ref), coalesce(p_max_percent::text || '%', 'بلا حدّ')));
end $$;

revoke all on function public.app_set_role_discount_limit(uuid, text, numeric) from public, anon;
grant execute on function public.app_set_role_discount_limit(uuid, text, numeric) to authenticated;

-- ── ٢د) فرضه في حفظ عرض السعر ──────────────────────────────────────────────
do $$
declare
  v_src    text;
  v_new    text;
  v_seg    text;
  v_anchor constant text := 'v_pct  := case when v_gross > 0 then round(v_disc / v_gross * 100.0, 2) else 0 end;';
  -- رقعة 0244 كما كُتبت حرفيًّا — تُستبدل إن وُجدت
  v_old0244 constant text := $o$

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
    end if;$o$;
  v_block constant text := $b$

    -- 0245: الخصم — المالك ومدير المنشأة والاستقبال بلا حدّ، ومن مُنح
    -- «agreements.discount» حتى حدّه في discount_limits، وغيرهم لا يغيّره.
    if not app_has_role(v_a.organization_id, array['owner', 'organization_admin', 'receptionist']) then
      declare
        v0245_changed boolean;
        v0245_max     numeric;
      begin
        if v_line_id is not null then
          v0245_changed := exists (select 1 from treatment_agreement_items x0245
                                    where x0245.id = v_line_id
                                      and abs(coalesce(x0245.discount_amount, 0) - v_disc) > 0.01
                                      and abs(coalesce(x0245.discount_percent, 0) - v_pct) > 0.01);
        else
          v0245_changed := v_disc > 0
                           and abs(v_pct - coalesce(v_item.default_discount_percent, 0)) > 0.01;
        end if;

        if v0245_changed then
          if not app_has_permission(v_a.organization_id, 'agreements.discount') then
            raise exception 'السطر % («%»): الخصم يحتاج صلاحية «خصم على عروض أسعار الاتفاقيات» — اترك الخصم كما هو', v_idx, v_item.name_ar;
          end if;
          v0245_max := app_discount_limit(v_a.organization_id);
          if v0245_max is not null and v_pct > v0245_max + 0.005 then
            raise exception 'السطر % («%»): أقصى خصمٍ مسموح لك %٪ والمكتوب %٪', v_idx, v_item.name_ar, v0245_max, v_pct;
          end if;
        end if;
      end;
    end if;$b$;
begin
  select pg_get_functiondef('public.app_save_agreement_quote(uuid,uuid,uuid,uuid,timestamptz,text,jsonb)'::regprocedure)
    into v_src;
  v_src := replace(v_src, chr(13), '');

  if position('-- 0245: الخصم' in v_src) > 0 then
    raise notice '0245 مطبّقة سلفًا على عرض السعر — لا تغيير';
    return;
  end if;

  if position(v_old0244 in v_src) > 0 then
    v_new := replace(v_src, v_old0244, v_block);
  elsif position('0244: الخصم' in v_src) > 0 then
    -- رقعة 0244 بنصٍّ يختلف حرفيًّا (مسافات/أسطر): تُحدَّد ببنيتها —
    -- من تعليقها حتى أوّل «end if; end if;» (نهاية: if role / if line … elsif … end if; end if;)
    if (length(v_src) - length(replace(v_src, '-- 0244: الخصم', ''))) / length('-- 0244: الخصم') <> 1 then
      raise exception 'رقعة 0244 مكرّرة في الدالّة — أوقفتُ الترحيل كلّه';
    end if;
    v_seg := substring(v_src from '-- 0244: الخصم.*?end if;\s*end if;');
    if v_seg is null
       or position('app_has_role' in v_seg) = 0
       or position('x0244' in v_seg) = 0
       or position('elsif' in v_seg) = 0
       or length(v_seg) > 2500 then
      raise exception 'رقعة 0244 موجودة لكن بنيتها تغيّرت — أوقفتُ الترحيل كلّه';
    end if;
    v_new := replace(v_src, v_seg, ltrim(v_block, E'\n '));
  else
    if (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 then
      raise exception 'تعذّر ترقيع app_save_agreement_quote — موضع حساب نسبة الخصم تغيّر';
    end if;
    v_new := replace(v_src, v_anchor, v_anchor || v_block);
  end if;

  execute v_new;
  raise notice '0245 ✓ خصم عروض الأسعار بالصلاحية وحدّها';
end $$;

commit;
