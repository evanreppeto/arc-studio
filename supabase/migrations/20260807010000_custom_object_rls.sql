-- Row-level security for the custom-object tables.
--
-- A SEPARATE FILE, not an edit to 20260806140000, because that one has already
-- shipped: it is in supabase_migrations.schema_migrations on production, so
-- editing it would change what a fresh database builds while never re-running
-- against prod — the two would silently diverge.
--
-- WHAT HAPPENED
--
-- 20260806140000 created custom_objects and custom_object_records with org_id
-- and no RLS. `authenticated` and `anon` hold a blanket SELECT grant in this
-- database, so a tenancy column with no policy is a cross-tenant read. The
-- Migrations `chain` job caught it precisely — "Table(s) carry org_id but have
-- RLS DISABLED" — but it is not a required check, so auto-merge fired anyway
-- and migrate-prod applied the table without its policy.
--
-- Nothing was exposed: both tables were empty (0 rows, 0 orgs) the whole time,
-- and the statements below were applied to production by hand within minutes,
-- then verified as anon and as a non-member authenticated role.
--
-- IDEMPOTENT ON PURPOSE. These statements already ran against prod, so this
-- file has to be safe to run again — `enable row level security` is a no-op
-- when already on, `drop policy if exists` makes the create safe, and grants
-- are idempotent. Deliberately NOT hand-inserted into the ledger: a ledger row
-- claiming applied-but-never-run is the failure mode that hides a missing
-- policy, and re-running this costs nothing.

alter table public.custom_objects enable row level security;
alter table public.custom_object_records enable row level security;

drop policy if exists custom_objects_org_member_select on public.custom_objects;
create policy custom_objects_org_member_select on public.custom_objects
  as permissive for select to authenticated
  using ((select app_private.is_org_member(custom_objects.org_id)));

drop policy if exists custom_object_records_org_member_select on public.custom_object_records;
create policy custom_object_records_org_member_select on public.custom_object_records
  as permissive for select to authenticated
  using ((select app_private.is_org_member(custom_object_records.org_id)));

-- The admin client every write in src/lib/custom-objects/ goes through.
grant select, insert, update, delete on public.custom_objects to service_role;
grant select, insert, update, delete on public.custom_object_records to service_role;
