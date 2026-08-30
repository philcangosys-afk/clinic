begin;

alter function app_visit_service_status_allowed(text, text)
  set search_path = public, pg_temp;

revoke all on function app_fill_claim_item_code() from public, anon, authenticated;
revoke all on function app_pvs_status_on_claim() from public, anon, authenticated;
revoke all on function app_pvs_status_on_invoice_item() from public, anon, authenticated;
revoke all on function app_pvs_status_on_invoice_status() from public, anon, authenticated;
revoke all on function app_pvs_status_on_return_invoice() from public, anon, authenticated;

create index if not exists idx_item_branches_org_item on item_branches (organization_id, item_id);
create index if not exists idx_item_branches_org_branch on item_branches (organization_id, branch_id);
create index if not exists idx_item_resources_org_item on item_resources (organization_id, item_id);
create index if not exists idx_item_resources_org_resource on item_resources (organization_id, resource_id);
create index if not exists idx_item_claim_codes_org_item on item_claim_codes (organization_id, item_id);
create index if not exists idx_item_claim_codes_org_company on item_claim_codes (organization_id, insurance_company_id);
create index if not exists idx_price_lists_org_branch_fk on price_lists (organization_id, branch_id);
create index if not exists idx_price_lists_org_company_fk on price_lists (organization_id, insurance_company_id);
create index if not exists idx_price_lists_org_client_fk on price_lists (organization_id, external_client_id);
create index if not exists idx_price_list_items_org_list on price_list_items (organization_id, price_list_id);
create index if not exists idx_price_list_items_org_item on price_list_items (organization_id, item_id);
create index if not exists idx_resources_org_clinic on resources (organization_id, clinic_id);
create index if not exists idx_items_org_default_clinic on items (organization_id, default_clinic_id);
create index if not exists idx_items_org_revenue_account on items (organization_id, revenue_account_id);
create index if not exists idx_items_org_cogs_account on items (organization_id, cogs_account_id);

-- القراءة مستقلة عن الكتابة حتى لا تنطبق سياستان permissive على SELECT.
drop policy if exists "item_branches_read" on item_branches;
drop policy if exists "item_branches_write" on item_branches;
create policy "item_branches_read" on item_branches for select to authenticated
  using (app_is_member(organization_id));
create policy "item_branches_insert" on item_branches for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy "item_branches_update" on item_branches for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy "item_branches_delete" on item_branches for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists resources_select on resources;
drop policy if exists resources_write on resources;
create policy resources_select on resources for select to authenticated
  using (app_is_member(organization_id));
create policy resources_insert on resources for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy resources_update on resources for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy resources_delete on resources for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists item_resources_select on item_resources;
drop policy if exists item_resources_write on item_resources;
create policy item_resources_select on item_resources for select to authenticated
  using (app_is_member(organization_id));
create policy item_resources_insert on item_resources for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy item_resources_update on item_resources for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy item_resources_delete on item_resources for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists item_claim_codes_select on item_claim_codes;
drop policy if exists item_claim_codes_write on item_claim_codes;
create policy item_claim_codes_select on item_claim_codes for select to authenticated
  using (app_is_member(organization_id));
create policy item_claim_codes_insert on item_claim_codes for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy item_claim_codes_update on item_claim_codes for update to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'))
  with check (app_has_permission(organization_id, 'catalog.manage'));
create policy item_claim_codes_delete on item_claim_codes for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.manage'));

drop policy if exists "price_lists_read" on price_lists;
drop policy if exists "price_lists_write" on price_lists;
create policy "price_lists_read" on price_lists for select to authenticated
  using (app_is_member(organization_id));
create policy "price_lists_insert" on price_lists for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.pricing'));
create policy "price_lists_update" on price_lists for update to authenticated
  using (app_has_permission(organization_id, 'catalog.pricing'))
  with check (app_has_permission(organization_id, 'catalog.pricing'));
create policy "price_lists_delete" on price_lists for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.pricing'));

drop policy if exists "price_list_items_read" on price_list_items;
drop policy if exists "price_list_items_write" on price_list_items;
create policy "price_list_items_read" on price_list_items for select to authenticated
  using (app_is_member(organization_id));
create policy "price_list_items_insert" on price_list_items for insert to authenticated
  with check (app_has_permission(organization_id, 'catalog.pricing'));
create policy "price_list_items_update" on price_list_items for update to authenticated
  using (app_has_permission(organization_id, 'catalog.pricing'))
  with check (app_has_permission(organization_id, 'catalog.pricing'));
create policy "price_list_items_delete" on price_list_items for delete to authenticated
  using (app_has_permission(organization_id, 'catalog.pricing'));

commit;
