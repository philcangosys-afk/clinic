-- ============================================================================
-- 0227_purchase_request_self_approval.sql
-- ============================================================================
-- طلب المالك (05/10/2026): «اجعل مقدّم الطلب يعتمده عادي».
--
-- `app_approve_purchase_request` (0097) كانت ترفض اعتماد الطلب ممّن قدّمه
-- («لا يعتمد الطلبَ مقدّمُه — يلزم معتمِد آخر»). يُزال هذا الشرط وحده؛ تبقى
-- بقيّة الحراسات كما هي: صلاحية purchasing.approve، وحالة «مقدَّم»، ودور
-- الاعتماد بحسب قيمة الطلب.
--
-- الترقيع بنصّ الدالّة القائمة في القاعدة (لا بنسخة الملف)، ومعاملة واحدة.
-- لا يمسّ الفواتير ولا ZATCA ولا التحويلات المخزنية ولا الجرد ولا المسيرات.
-- ============================================================================

begin;
set local lock_timeout = '8s';

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_approve_purchase_request'
   limit 1;
  if v_src is null then
    raise exception 'الدالّة app_approve_purchase_request غير موجودة';
  end if;
  v_src := replace(v_src, chr(13), '');

  if position('لا يعتمد الطلبَ مقدّمُه' in v_src) = 0 then
    raise notice 'شرط «مقدّم الطلب لا يعتمده» غير موجود — لا تغيير';
    return;
  end if;

  v_new := regexp_replace(
    v_src,
    '\n[ \t]*if v_r\.requested_by is not null and v_r\.requested_by = auth\.uid\(\) then\s*\n[ \t]*raise exception ''لا يعتمد الطلبَ مقدّمُه[^'']*'';\s*\n[ \t]*end if;',
    E'\n  -- (0227) مقدّم الطلب يستطيع اعتماده — بطلب المالك',
    'g');
  -- تعليق الشرط القديم فوقه
  v_new := regexp_replace(v_new, '\n[ \t]*-- \*\*مقدّم الطلب لا يعتمده\*\*[^\n]*', '', 'g');

  if v_new = v_src or position('لا يعتمد الطلبَ مقدّمُه' in v_new) > 0 then
    raise exception 'تعذّر إزالة شرط مقدّم الطلب من app_approve_purchase_request';
  end if;
  execute v_new;
end $$;

commit;

notify pgrst, 'reload schema';

select case when position('لا يعتمد الطلبَ مقدّمُه' in pg_get_functiondef(p.oid)) = 0
            then 'مقدّم الطلب يستطيع اعتماده الآن'
            else 'الشرط ما زال موجودًا' end as "النتيجة"
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'app_approve_purchase_request';
