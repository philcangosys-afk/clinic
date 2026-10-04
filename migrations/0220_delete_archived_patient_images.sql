-- ============================================================================
-- 0220_delete_archived_patient_images.sql — حذف الصور المؤرشفة من ملفّ المريض
-- ============================================================================
-- طلب المالك (04/10/2026): «اعمل خيار حذف الصور المؤرشفة من ملف المريض».
--
-- المستندات لا تُحذف منذ 0102 (مُحفِّز `trg_block_delete_patient_documents`)،
-- والأرشفة هي الطريق. هذا استثناءٌ ضيّق بطلب المالك:
--   • صورة (`category = 'image'`) **مؤرشفة** فقط — لا مستند ولا موافقة ولا
--     ما وُقّع، ولا ما تشير إليه موافقةٌ أو توقيع.
--   • للمالك ومدير النظام ومدير الفرع وحدهم، وبسببٍ مكتوب.
--   • سطرٌ في سجلّ التدقيق باسم الملفّ وسبب أرشفته وسبب حذفه.
--   • المُحفِّز يبقى يمنع كلّ حذفٍ آخر: يسمح فقط داخل هذه الدالّة (إعدادٌ
--     محلّيّ للمعاملة لا يستطيع العميل ضبطه).
-- الملفّ نفسه يُحذف من التخزين من الشاشة بعد نجاح الدالّة (Storage API).
-- ============================================================================

begin;
set local lock_timeout = '8s';

create or replace function app_block_document_delete()
returns trigger
language plpgsql
as $$
begin
  -- 0220: الاستثناء الوحيد — حذف صورةٍ مؤرشفة بدالّة app_delete_archived_patient_image
  if tg_table_name = 'patient_documents'
     and coalesce(current_setting('app.allow_document_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'المستندات والتواقيع لا تُحذف — استخدم الأرشفة بسبب موثَّق';
end $$;

create or replace function public.app_delete_archived_patient_image(p_document_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d        record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول';
  end if;

  select pd.* into d from patient_documents pd where pd.id = p_document_id for update;
  if not found then
    raise exception 'الصورة غير موجودة';
  end if;
  if not app_is_member(d.organization_id) then
    raise exception 'لا تنتمي لهذه المنشأة';
  end if;
  if not app_has_role(d.organization_id, array['owner', 'organization_admin', 'branch_manager']) then
    raise exception 'حذف الصور المؤرشفة للمالك والمدير وحدهما';
  end if;
  if v_reason is null then
    raise exception 'اكتب سبب الحذف';
  end if;
  if coalesce(d.category, '') <> 'image' then
    raise exception 'يُحذف ما كان صورةً فقط — المستندات تبقى مؤرشفة';
  end if;
  if not coalesce(d.is_archived, false) then
    raise exception 'أرشِف الصورة أوّلًا — لا يُحذف إلّا المؤرشف';
  end if;
  if coalesce(d.is_consent, false) or d.signed_at is not null then
    raise exception 'صورة موافقة أو موقَّعة — لا تُحذف';
  end if;
  if exists (select 1 from document_signatures s
              where s.document_kind = 'patient_document' and s.document_id = d.id) then
    raise exception 'على الصورة توقيع — لا تُحذف';
  end if;
  if to_regclass('public.patient_consents') is not null
     and exists (select 1 from patient_consents c where c.document_id = d.id) then
    raise exception 'الصورة مرفقة بموافقة مريض — لا تُحذف';
  end if;

  perform set_config('app.allow_document_delete', 'on', true);
  delete from patient_documents where id = d.id;
  perform set_config('app.allow_document_delete', '', true);

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (d.organization_id, auth.uid(), 'patients', 'delete', d.patient_id,
          'حذف صورة مؤرشفة من ملفّ المريض',
          format('%s — سبب الأرشفة: %s — سبب الحذف: %s',
                 coalesce(d.file_name, 'بلا اسم'), coalesce(d.archive_reason, '—'), v_reason));

  return d.storage_path;
end $$;

revoke all on function public.app_delete_archived_patient_image(uuid, text) from public, anon;
grant execute on function public.app_delete_archived_patient_image(uuid, text) to authenticated;

comment on function public.app_delete_archived_patient_image(uuid, text) is
  'حذف صورةٍ مؤرشفة (غير موقَّعة ولا موافقة) من ملفّ المريض — للمالك والمدير، بسبب، مع سطر تدقيق. يُرجع مسار الملفّ في التخزين. 0220.';

commit;

notify pgrst, 'reload schema';

select 'صور مؤرشفة يمكن حذفها' as "البند", count(*)::text as "العدد"
  from patient_documents
 where category = 'image' and is_archived and not coalesce(is_consent, false) and signed_at is null;
