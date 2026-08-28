-- 0037: تجهيزات المرحلة الأولى من سد فجوات تدقيق اللقطات
--
-- 1) دلو تخزين (Storage bucket) لمستندات وصور المرضى — الجدول patient_documents
--    موجود منذ 0006 لكن بلا مكان فعلي لتخزين الملفات، ولذلك بقيت الميزة معطّلة.
-- 2) عرض v_audit_log_detail — سجل التدقيق يخزّن user_id لكن الواجهة لا تستطيع
--    قراءة auth.users مباشرة، فبقي عمود "المستخدم" غير معروض رغم تسجيله.
--
-- ملاحظة: تصنيفات أنواع المستندات (patient_document_types) مزروعة بالفعل في
-- 0006 بقيمها الكاملة — لا حاجة لإعادة زرعها هنا.

-- ═══════════════════════════════════════════════════════════
-- 1) دلو تخزين مستندات المرضى
-- ═══════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
select 'patient-documents', 'patient-documents', false
where not exists (select 1 from storage.buckets where id = 'patient-documents');

-- الوصول محكوم بعضوية المؤسسة: أول جزء من المسار هو organization_id،
-- فيتحقق من أن المستخدم عضو في تلك المؤسسة قبل السماح بأي عملية.
-- المسار المعتمد: {organization_id}/{patient_id}/{uuid}-{filename}

drop policy if exists "patient_documents_read_members" on storage.objects;
create policy "patient_documents_read_members" on storage.objects
  for select using (
    bucket_id = 'patient-documents'
    and exists (
      select 1 from organization_memberships m
      where m.user_id = auth.uid()
        and m.organization_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "patient_documents_insert_members" on storage.objects;
create policy "patient_documents_insert_members" on storage.objects
  for insert with check (
    bucket_id = 'patient-documents'
    and exists (
      select 1 from organization_memberships m
      where m.user_id = auth.uid()
        and m.organization_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "patient_documents_delete_members" on storage.objects;
create policy "patient_documents_delete_members" on storage.objects
  for delete using (
    bucket_id = 'patient-documents'
    and exists (
      select 1 from organization_memberships m
      where m.user_id = auth.uid()
        and m.organization_id::text = (storage.foldername(name))[1]
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 2) عرض سجل التدقيق مع بريد المستخدم
-- ═══════════════════════════════════════════════════════════
-- ملاحظة أمنية: العرض يقرأ auth.users (غير متاحة للعميل مباشرة) ويكشف
-- البريد فقط — لا كلمات مرور ولا رموز. التصفية بالمؤسسة تبقى مسؤولية
-- الاستعلام كما هو عرف بقية عروض المشروع (‎.eq("organization_id", ...)‎).

create or replace view v_audit_log_detail as
select
  a.id,
  a.organization_id,
  a.occurred_at,
  a.user_id,
  u.email as user_email,
  a.device_name,
  a.action_type,
  a.module,
  a.entity_id,
  a.entity_title,
  a.details,
  a.reason
from audit_log a
left join auth.users u on u.id = a.user_id;

