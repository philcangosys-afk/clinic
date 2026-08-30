begin;

drop policy if exists "items_all_members" on items;
drop policy if exists "items_select_members" on items;
drop policy if exists "items_insert_authorized" on items;
drop policy if exists "items_update_authorized" on items;
drop policy if exists "items_delete_authorized" on items;

create policy "items_select_members" on items
for select to authenticated
using (app_is_member(organization_id));

create policy "items_insert_authorized" on items
for insert to authenticated
with check (
  app_has_permission(organization_id, 'catalog.manage')
  or (
    item_type = 'drug'
    and app_has_role(organization_id, array['pharmacist'])
  )
);

create policy "items_update_authorized" on items
for update to authenticated
using (
  app_has_permission(organization_id, 'catalog.manage')
  or (
    item_type = 'drug'
    and app_has_role(organization_id, array['pharmacist'])
  )
)
with check (
  app_has_permission(organization_id, 'catalog.manage')
  or (
    item_type = 'drug'
    and app_has_role(organization_id, array['pharmacist'])
  )
);

-- لا توجد سياسة DELETE: السجل التاريخي يبقى، والإخراج من الخدمة يمر بالأرشفة.

commit;
