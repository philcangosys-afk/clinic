-- ============================================================================
-- 0230_invoice_share_links.sql — إرسال الفاتورة بالواتساب فاتورةً لا نصًّا
-- ============================================================================
-- طلب المالك (05/10/2026): «الفاتورة التي تُرسل في الواتساب أو المشاركة تذهب
-- نصًّا فقط — اجعلها فاتورة احترافية نفس التي تُطبع».
--
-- روابط wa.me لا تحمل مرفقًا، فتُرفع الفاتورة PDF (الورقة المطبوعة نفسها) إلى
-- حاوية `invoice-shares` ويُرسل رابطها في الرسالة.
--
--   • الحاوية عامّة القراءة بالرابط المباشر فقط؛ سردُ محتوياتها لأعضاء المنشأة
--     وحدهم (مجلّد منشأتهم)، ولا يسردها غيرهم. ويحمي الرابطَ معرّفٌ عشوائيّ
--     (UUID) في مساره.
--   • الكتابة لأعضاء المنشأة وحدهم، وفي مجلّد منشأتهم فقط
--     (`<organization_id>/...`)، وPDF وحده بحدّ 5MB.
--   • لا تعديل ولا حذف من الواجهة: الرابط المُرسَل للمريض يبقى صالحًا.
-- آمنة للتكرار.
-- ============================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'invoice-shares', 'invoice-shares', true, 5242880, array['application/pdf']
where not exists (select 1 from storage.buckets where id = 'invoice-shares');

update storage.buckets
   set public = true, file_size_limit = 5242880, allowed_mime_types = array['application/pdf']
 where id = 'invoice-shares';

drop policy if exists "invoice_shares_insert_members" on storage.objects;
create policy "invoice_shares_insert_members" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'invoice-shares'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

-- أعضاء المنشأة يقرؤون ملفّات منشأتهم (يحتاجها الرفع في بعض إصدارات التخزين)؛
-- والمريض يفتح الرابط العامّ المباشر بلا هذه السياسة.
drop policy if exists "invoice_shares_select_members" on storage.objects;
create policy "invoice_shares_select_members" on storage.objects
  for select to authenticated using (
    bucket_id = 'invoice-shares'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

commit;

select 'حاوية روابط الفواتير' as "البند",
       case when exists (select 1 from storage.buckets where id = 'invoice-shares' and public)
             and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                          and policyname = 'invoice_shares_insert_members')
            then 'جاهزة' else 'مفقودة' end as "الحالة";
