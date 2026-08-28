-- 0045: دلو تخزين مرفقات نتائج المختبر وصور الأشعة
--
-- جدولا `lab_result_attachments` (0013) و`radiology_images` (0014) موجودان
-- منذ البداية وفيهما `file_url` — لكن لا مكان فعليًا لتخزين الملف، تمامًا
-- كما كان حال `patient_documents` قبل 0037. النتيجة: نتيجة أشعة بلا صورة،
-- ونتيجة مختبر بلا ورقة التحليل الأصلية.
--
-- **دلو واحد للاثنين** لا دلوان: سياسات التخزين تُكتب مرة واحدة وتُراجَع
-- مرة واحدة. الفصل بينهما يتم بالمجلد داخل المسار لا بدلو مستقل، فالنوعان
-- لهما نفس مستوى الحساسية (نتائج طبية) ونفس قاعدة الوصول (عضوية المنشأة).
--
-- المسار المعتمد: {organization_id}/{lab|radiology}/{order_id}/{ts}-{filename}
-- الجزء الأول هو organization_id — وعليه تُبنى كل السياسات أدناه.

insert into storage.buckets (id, name, public)
select 'result-attachments', 'result-attachments', false
where not exists (select 1 from storage.buckets where id = 'result-attachments');

-- ---------------------------------------------------------------------------
-- السياسات تستعمل `app_is_member` لا فحصًا يدويًا على organization_memberships.
--
-- هذا هو الدرس المستفاد من تدقيق 0037: الفحص اليدوي هناك أغفل شرط
-- `is_active`، فكان موظف مُعطَّل يحتفظ نظريًا بحق القراءة والكتابة والحذف على
-- مستندات المرضى (أُصلح في 0044). `app_is_member` تشترط `is_active = true`
-- في مكان واحد، فلا يتكرر الإغفال.
--
-- `(storage.foldername(name))[1]` قد لا يكون uuid صالحًا لو رُفع ملف بمسار
-- مشوَّه، ولذلك يُتحقَّق من الشكل أولًا — بدونه يرمي التحويل خطأً يمنع
-- العملية برسالة غامضة بدل رفضها بوضوح.
-- ---------------------------------------------------------------------------
drop policy if exists "result_attachments_read_members" on storage.objects;
create policy "result_attachments_read_members" on storage.objects
  for select using (
    bucket_id = 'result-attachments'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "result_attachments_insert_members" on storage.objects;
create policy "result_attachments_insert_members" on storage.objects
  for insert with check (
    bucket_id = 'result-attachments'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "result_attachments_delete_members" on storage.objects;
create policy "result_attachments_delete_members" on storage.objects
  for delete using (
    bucket_id = 'result-attachments'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- تقوية سياسات دلو مستندات المرضى بنفس التحقق من شكل المعرّف.
-- 0044 حوّلها إلى `app_is_member` لكنها تبقى عرضة لخطأ التحويل عند مسار مشوَّه.
-- ---------------------------------------------------------------------------
drop policy if exists "patient_documents_read_members" on storage.objects;
create policy "patient_documents_read_members" on storage.objects
  for select using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "patient_documents_insert_members" on storage.objects;
create policy "patient_documents_insert_members" on storage.objects
  for insert with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "patient_documents_delete_members" on storage.objects;
create policy "patient_documents_delete_members" on storage.objects
  for delete using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and app_is_member(((storage.foldername(name))[1])::uuid)
  );
