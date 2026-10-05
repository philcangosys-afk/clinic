-- ============================================================================
-- 0233_one_business_day_per_branch.sql — يومية واحدة لا يوميتان كلّ يوم
-- ============================================================================
-- شكوى المالك (05/10/2026): «لماذا يوميًّا تُفتح يوميتان تلقائيًّا؟» —
-- رقم 8 ورقم 9 فُتحتا في الدقيقة نفسها، وإحداهما بلا فواتير.
--
-- السبب: اليومية لكلّ (منشأة، فرع)، و`app_ensure_business_day` تُطابق الفرع
-- حرفيًّا — والفرع «الفارغ» يُعدّ فرعًا قائمًا بذاته:
--   • الفاتورة تأخذ فرعها من عيادتها (0203) ⇐ يومية «الفرع الرئيسي».
--   • سند القبض يأخذ `financial_vouchers.branch_id` كما هو — وهو فارغ في أغلب
--     السندات ⇐ يومية ثانية «بلا فرع».
-- فأوّل فاتورةٍ تُحصَّل كلّ صباح تفتح يوميتين: الفواتير في واحدة والمقبوض في
-- الأخرى، فلا يطابق جردُ أيٍّ منهما الصندوق.
--
-- الإصلاح:
--   ١) `app_default_branch(org)`: الفرع الوحيد للمنشأة، وإلّا فرعها الرئيسيّ
--      الوحيد، وإلّا لا شيء. و`app_ensure_business_day` تُحوّل الفرع الفارغ
--      إليه قبل البحث — فيلتقي «بلا فرع» و«الفرع الرئيسي» في يوميةٍ واحدة.
--   ٢) سند القبض بلا فرع يأخذ فرع فاتورته (أو فرع عيادتها) إن كان مرتبطًا بها.
--   ٣) اليوميتان المفتوحتان الآن تُدمجان: مستندات «بلا فرع» تنتقل إلى يومية
--      الفرع، وتُقفل الفارغة بملاحظة «دُمجت في…». لا يُحذف شيء، واليوميات
--      المُقفلة سابقًا لا تُمسّ.
--
-- يُرقَّع نصّا الدالّتين الحيّان بـ regex وتفشل الترقية صراحةً إن لم يطابقا.
-- آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── ١) الفرع الافتراضي للمنشأة ─────────────────────────────────────────────
create or replace function public.app_default_branch(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select min(b.id::text)::uuid from public.branches b
      where b.organization_id = p_organization_id
     having count(*) = 1),
    (select min(b.id::text)::uuid from public.branches b
      where b.organization_id = p_organization_id and b.is_main
     having count(*) = 1));
$$;

revoke all on function public.app_default_branch(uuid) from public, anon;
grant execute on function public.app_default_branch(uuid) to authenticated;

comment on function public.app_default_branch(uuid) is
  'فرع المنشأة الافتراضي: الوحيد، وإلّا الرئيسي الوحيد، وإلّا NULL — لمستندٍ بلا فرع (0233).';

-- ── ٢) اليومية: الفرع الفارغ ⇐ الفرع الافتراضي ─────────────────────────────
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef('public.app_ensure_business_day(uuid,uuid)'::regprocedure) into v_src;
  v_src := replace(v_src, chr(13), '');
  if position('app_default_branch' in v_src) > 0 then
    raise notice 'app_ensure_business_day تستعمل الفرع الافتراضي سلفًا — لا تغيير';
    return;
  end if;

  v_new := regexp_replace(v_src,
    '(\n\s*)(perform (public\.)?app_close_due_business_days_internal\(p_organization_id\);)',
    E'\\1-- بلا فرع ⇐ فرع المنشأة الافتراضي (0233): لا يوميةٌ ثانية «بلا فرع»'
      || E'\\1p_branch_id := coalesce(p_branch_id, public.app_default_branch(p_organization_id));'
      || E'\\1\\2');
  if v_new = v_src then
    raise exception 'تعذّر ترقيع app_ensure_business_day — تغيّر نصّها';
  end if;
  execute v_new;
end $$;

-- ── ٣) سند القبض: فرعه من فاتورته ──────────────────────────────────────────
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef('public.app_stamp_voucher_business_day()'::regprocedure) into v_src;
  v_src := replace(v_src, chr(13), '');
  if position('related_sales_invoice_id' in v_src) > 0 then
    raise notice 'app_stamp_voucher_business_day تقرأ فرع الفاتورة سلفًا — لا تغيير';
    return;
  end if;

  v_new := regexp_replace(v_src,
    'app_ensure_business_day\(new\.organization_id, new\.branch_id\)',
    'app_ensure_business_day(new.organization_id, coalesce(new.branch_id, '
      || '(select coalesce(i.branch_id, c.branch_id) from public.sales_invoices i '
      || 'left join public.clinics c on c.id = i.clinic_id where i.id = new.related_sales_invoice_id)))');
  if v_new = v_src then
    raise exception 'تعذّر ترقيع app_stamp_voucher_business_day — تغيّر نصّها';
  end if;
  execute v_new;
end $$;

-- ── ٤) دمج اليوميتين المفتوحتين الآن ───────────────────────────────────────
do $$
declare
  r        record;
  v_inv    int;
  v_vch    int;
begin
  for r in
    select nb.id as null_day, nb.day_number as null_number,
           bd.id as branch_day, bd.day_number as branch_number, nb.organization_id
      from public.business_days nb
      join public.business_days bd
        on bd.organization_id = nb.organization_id
       and bd.branch_id = public.app_default_branch(nb.organization_id)
       and bd.closed_at is null
     where nb.branch_id is null
       and nb.closed_at is null
  loop
    update public.sales_invoices set business_day_id = r.branch_day where business_day_id = r.null_day;
    get diagnostics v_inv = row_count;
    update public.financial_vouchers set business_day_id = r.branch_day where business_day_id = r.null_day;
    get diagnostics v_vch = row_count;
    update public.business_days
       set closed_at = now(),
           note = concat_ws(' · ', nullif(note, ''),
                  format('دُمجت في اليومية رقم %s (0233): نُقلت %s فاتورة و%s سندًا', r.branch_number, v_inv, v_vch))
     where id = r.null_day;
    raise notice 'دُمجت اليومية % في % — % فاتورة و% سند', r.null_number, r.branch_number, v_inv, v_vch;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';

select 'الفرع الافتراضي للمنشأة' as "البند",
       coalesce((select b.name from public.branches b
                  where b.id = public.app_default_branch(
                    (select organization_id from public.business_days order by opened_at desc limit 1))),
                'لا يوجد (عدّة فروع بلا رئيسي)') as "الحالة"
union all
select 'اليومية تُوحِّد «بلا فرع» مع الفرع الافتراضي',
       case when pg_get_functiondef('public.app_ensure_business_day(uuid,uuid)'::regprocedure) like '%app_default_branch%'
            then 'جاهزة' else 'مفقودة' end
union all
select 'السند يأخذ فرع فاتورته',
       case when pg_get_functiondef('public.app_stamp_voucher_business_day()'::regprocedure) like '%related_sales_invoice_id%'
            then 'جاهزة' else 'مفقودة' end
union all
select 'اليوميات المفتوحة الآن', count(*)::text from public.business_days where closed_at is null;
