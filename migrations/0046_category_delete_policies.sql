-- 0046: سياسات حذف تصنيفات فحوصات المختبر والأشعة
--
-- `lab_test_categories` (0013) و`radiology_exam_categories` (0014) عليهما RLS
-- مع سياسات SELECT و INSERT و UPDATE فقط — **بلا أي سياسة DELETE**. أي أن حذف
-- تصنيف كان يطابق صفرًا من الصفوف دائمًا ولأي مستخدم، حتى مالك المنشأة.
--
-- مُثبَت بالتنفيذ الفعلي بدور `authenticated`:
--   delete from lab_test_categories where id = ... returning id;  -->  DELETE 0
--   select count(*) ...                                           -->  1 (لا يزال)
--
-- الأثر قبل الإصلاح: تصنيف أُنشئ بخطأ إملائي لا يمكن حذفه من التطبيق أبدًا،
-- والرسالة المعروضة تلوم صلاحية المستخدم بينما لا صلاحية تمنحه ذلك أصلًا.
--
-- **الحذف مقصور على تصنيفات المنشأة نفسها**: الصفوف العامة
-- (`organization_id is null`) مشتركة بين كل المنشآت — حذف منشأةٍ لتصنيف عام
-- يحذفه من كل المنشآت. الشرط `organization_id is not null` يجعل ذلك مستحيلًا
-- في القاعدة لا في الواجهة وحدها.

drop policy if exists "lab_test_categories_delete_admins" on lab_test_categories;
create policy "lab_test_categories_delete_admins" on lab_test_categories
  for delete using (
    organization_id is not null
    and app_is_org_admin(organization_id)
  );

drop policy if exists "radiology_exam_categories_delete_admins" on radiology_exam_categories;
create policy "radiology_exam_categories_delete_admins" on radiology_exam_categories
  for delete using (
    organization_id is not null
    and app_is_org_admin(organization_id)
  );
