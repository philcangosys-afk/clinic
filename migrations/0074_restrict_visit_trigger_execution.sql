begin;

revoke all on function app_enforce_visit_branch_access() from public, anon, authenticated;

commit;
