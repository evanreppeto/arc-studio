# Drop the status_backup_20260729_* tables (BSR-651)

**Status: verified, not yet executed.** Needs a human to run it — see why below.

## What

Three tables exist in production that **no migration creates**. They were made by
hand while applying `20260729170000_pipeline_status_to_text.sql`, which is
destructive DDL that `migrate-prod.yml` refuses by design.

| table | rows |
| --- | --- |
| `status_backup_20260729_jobs` | 62 |
| `status_backup_20260729_leads` | 200 |
| `status_backup_20260729_outcomes` | 63 |

## Why they should go

RLS is **disabled** on all three, and `anon` holds `SELECT/INSERT/UPDATE/DELETE/
TRUNCATE` through the `pg_default_acl` blanket grant. Verified *as the anon role*,
not inferred from the grant table:

```sql
begin; set local role anon;
select count(*) from public.status_backup_20260729_leads;  -- 200
rollback;
```

They are also invisible to the guard that would otherwise catch this:
`rls-cross-tenant.sql` assertion 5 flags tables carrying `org_id` with RLS off,
and these carry no `org_id`. Same blind spot BSR-638 closed for classification.

**Deliberately not called a leak.** Two columns (`id`, `status`), no names, emails
or phone numbers, and every row belongs to the archived seed org. What `anon` can
read is a list of UUIDs and status strings for fake records. The real problems are
that `anon` can `TRUNCATE` them, and that the pattern would leak next time it is
used on a table whose columns matter.

## Why it is safe — checked, not assumed

The migration they were taken for is a **widening**: enum → text via `::text`,
which preserves every existing value exactly. Its own header says no data can be
lost by the conversion.

Confirmed against prod on 2026-08-03, comparing all 325 backed-up rows to the live
tables:

| check | result |
| --- | --- |
| rows whose `status` now differs from the backup | **0** |
| backed-up rows no longer present in the live table | **0** |

So the backups are a byte-identical duplicate of data that is still live. Dropping
them loses nothing. **Had a single row differed, the backup would have been the
only record of the old value and this runbook would say do not drop.**

Re-run the check before executing, in case something has changed since:

```sql
select 'leads' as t,
  (select count(*) from public.status_backup_20260729_leads b
     join public.leads l on l.id = b.id where l.status is distinct from b.status) as differs_now,
  (select count(*) from public.status_backup_20260729_leads b
     left join public.leads l on l.id = b.id where l.id is null) as row_gone
union all
select 'jobs',
  (select count(*) from public.status_backup_20260729_jobs b
     join public.jobs j on j.id = b.id where j.status is distinct from b.status),
  (select count(*) from public.status_backup_20260729_jobs b
     left join public.jobs j on j.id = b.id where j.id is null)
union all
select 'outcomes',
  (select count(*) from public.status_backup_20260729_outcomes b
     join public.outcomes o on o.id = b.id where o.status is distinct from b.status),
  (select count(*) from public.status_backup_20260729_outcomes b
     left join public.outcomes o on o.id = b.id where o.id is null);
```

All six numbers must be `0`. If any is not, stop.

## Why this is not a migration

Two reasons, and both matter:

1. **`migrate-prod.yml` refuses `drop table`** — deliberately. Adding a migration
   containing one would fail the prod deploy step and tell a human to do it by
   hand, which is exactly this document.
2. **The chain never created these tables.** A fresh database built from
   `supabase/migrations` does not have them, so a drop migration would be a no-op
   everywhere except prod — a file whose only effect is to trip the guardrail.

## The statements

```sql
drop table if exists public.status_backup_20260729_jobs;
drop table if exists public.status_backup_20260729_leads;
drop table if exists public.status_backup_20260729_outcomes;
```

No migration-ledger entry: there is no migration to record.

## After

`pnpm db:check-tenancy` currently reports these three as "contract entries absent
from this database" when run against a chain-built database. They have already
been removed from `supabase/tenancy-contract.mjs`, so once they are dropped from
prod the note disappears and prod and the chain agree.
