# Backing up and restoring prod

## Read this first

**The Supabase org is on the `free` plan.** Automated daily backups and
point-in-time recovery are paid features, so prod has neither (BSR-532, verified
2026-07-30 via `get_organization` → `plan: "free"`).

`.github/workflows/backup-prod.yml` is a **compensating control**, not a
replacement. Know exactly what it does and does not give you:

| | |
| --- | --- |
| **RPO** (data you can lose) | **~24 hours** — the gap since the last nightly run |
| **RTO** (time to recover) | **3–6 seconds** of restore, measured across runs 2026-07-31 — provisioning a target Supabase project dominates the real recovery time |
| Point-in-time recovery | **no** — cannot rewind to just before a mistake |
| Retention | **365 days** primary, 90 days secondary |
| Where | `gs://arc-prod-backups-706961882086` (primary) + GitHub artifact (second copy), both `age`-encrypted |

Two destinations on purpose. If the GCP project is the thing that breaks, the
artifact is still there; if GitHub is, the bucket is.

Upgrading to Pro is still the right answer. This exists so "unrecoverable" stops
being true while that decision is made.

---

## One-time setup

The repository is **public**, so artifacts are downloadable by anyone who can see
a workflow run. A plaintext dump would publish every contact, email address and
campaign. The dump is therefore encrypted to a key only you hold.

```bash
# 1. Generate a keypair. Do this on your own machine.
age-keygen -o arc-backup.key
```

That prints a public key like `age1ql3z...`. The file `arc-backup.key` contains
the **private** half.

```bash
# 2. Give CI the PUBLIC half. A repo variable, not a secret — public keys are
#    public, and CI only ever needs to encrypt.
gh variable set BACKUP_AGE_RECIPIENT --body "age1ql3z..."
```

```bash
# 3. Run it once by hand to confirm.
gh workflow run backup-prod.yml
gh run watch
```

**Store `arc-backup.key` somewhere that survives losing this laptop** — a
password manager entry is fine; it is a few lines of text. If you lose it, every
backup produced becomes permanently unreadable, including ones already taken.
Nothing in this repo or in CI can recover it, which is the same property that
makes the public artifact safe.

Do not commit it. Do not paste it into a GitHub secret — CI has no reason to
decrypt, and a decryption key in CI would undo the whole design.

---

## Restoring

### 1. Get a backup

From the bucket (primary — a year of history):

```bash
gcloud storage ls gs://arc-prod-backups-706961882086/
gcloud storage cp gs://arc-prod-backups-706961882086/arc-prod-<stamp>.tar.gz.age .
```

Or from a GitHub artifact (second copy, last 90 days):

```bash
gh run list --workflow backup-prod.yml --limit 10
gh run download <run-id>
```

> You can read the bucket; **CI cannot**. The workflow's service account holds
> `roles/storage.objectCreator` and nothing else, so it can write a new backup
> but cannot read one back or delete one. A compromised workflow can therefore
> neither exfiltrate the history nor destroy it.

### 2. Decrypt and unpack

```bash
age -d -i arc-backup.key -o arc-prod.tar.gz arc-prod-<stamp>.tar.gz.age
tar -xzf arc-prod.tar.gz   # 00-prereq  schema  auth-users  data  restore.sh
```

### 3. Restore

`restore.sh` ships inside the tarball and does the whole sequence in the order
below. Prefer it over running the files by hand.

```bash
./restore.sh "postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres"
```

> **Restore into a scratch project first, never straight over prod.** Create a
> new Supabase project, restore there, confirm the data, and only then decide
> what to do with the live one. Restoring onto a database that is still serving
> traffic turns a recoverable incident into two problems.

By hand, the order is **prereq → schema → accounts → data**, and every step in
it was established by the restore test below rather than by reasoning:

| Step | Why it is where it is |
| --- | --- |
| `00-prereq.sql` | Creates `vector`. A `--schema=public` dump never emits `CREATE EXTENSION`, and without it `knowledge_nodes` — Arc's memory — cannot be created. |
| `schema.sql` | Carries `public` **and** `app_private` from one dump, so the four SECURITY DEFINER functions exist before the 138 policies that call them. |
| `auth-users.sql` | **Before the data**, because public tables carry foreign keys to `auth.users`. Holds `identities` too, or accounts exist that cannot log in. |
| `data.sql` | Loaded with `session_replication_role = replica`. `campaigns → approval_items → campaign_assets → campaigns` is a cycle, so no ordering satisfies it unaided. |

### 4. Confirm it is real

`restore.sh` prints the counts below on its own. Compare them against prod:

```sql
select
  (select count(*) from pg_policies where schemaname='public') as policies,
  (select count(*) from public.organizations)   as orgs,
  (select count(*) from public.campaigns)       as campaigns,
  (select count(*) from public.knowledge_nodes) as brain,
  (select count(*) from auth.users)             as users;
```

On 2026-07-31 prod held **157 policies, 2 orgs, 11 contacts, 200 leads, 19
campaigns, 40 approval items, 490 knowledge nodes and 4 accounts**, in a 29 MB
database across 113 public tables.

A zero in `policies`, `campaigns`, `brain` or `users` means a step did not take.
Those are precisely the four things the pre-2026-07-31 backup lost silently.

Then sign in against the restored database and load `/crm` — a row count proves
the bytes arrived, not that the application can read them.

---

## What is NOT covered

**Supabase Storage.** The `campaign-media` bucket (2 objects, ~450 KB as of
2026-07-30) holds generated creative. `storage.objects` *metadata* is in the
Postgres dump; **the file bytes are not.** A restore brings back rows pointing at
objects that do not exist.

Small enough today to accept as a known gap. Worth syncing alongside the dump
before real customer media accumulates — tracked on BSR-532.

**Anything newer than the last nightly run.** See RPO above.

**GCS.** Not configured on prod at all (`GCS_*` unset). It only ever powered
reference-image upload, and no prod media lives there — contrary to what BSR-532
originally assumed.

---

## The restore test — 2026-07-31

**A backup that has never been restored is a hypothesis.** The first real
restore of `arc-prod-20260731T151011Z` was performed into a throwaway
`supabase/postgres:17.6` container. **It failed**, in five separate ways, none
of which the workflow's own checks could see.

What the backup as taken actually restored to:

| | Prod | Restored | |
| --- | --- | --- | --- |
| RLS policies | 157 | **19** | 138 policies call `app_private`, which was not dumped |
| Campaigns | 19 | **0** | circular FK; 17 tables in the cluster took the same failure |
| Approval items | 40 | **0** | same cluster |
| Knowledge nodes (Arc's memory) | 490 | **0** | `vector` extension not emitted, so the table was never created |
| Accounts | 4 | **0** | `data.sql` restored before `auth-users.sql`, so every FK to `auth.users` failed |

The one piece of good news: tables restored **RLS-enabled with no policy**, which
denies all access rather than granting it. A broken restore fails closed.

The five defects, all now fixed in `backup-prod.yml`:

1. **`app_private` not dumped.** `--schema=public` alone omits the four
   SECURITY DEFINER functions every isolation policy calls. Fixed by dumping
   both schemas in *one* pg_dump so ordering holds.
2. **`vector` not emitted.** It lives in `public` here, and a schema-scoped dump
   never emits `CREATE EXTENSION`. Fixed with a generated `00-prereq.sql`.
3. **Restore order inverted.** Data before accounts fails every FK to
   `auth.users`. Fixed in `restore.sh`.
4. **Circular foreign keys.** `campaigns → approval_items → campaign_assets →
   campaigns` cannot be loaded in any order. Fixed with
   `session_replication_role = replica` around the data load.
5. **`auth.identities` not dumped.** Without it GoTrue cannot match a login to a
   user: every account restores, and nobody can sign in.

**After the fixes, a clean restore reproduced prod exactly** — 157 policies, 2
orgs, 11 contacts, 200 leads, 19 campaigns, 40 approval items, 490 knowledge
nodes, 4 accounts — with zero errors, in **3 seconds**, and with referential integrity intact despite the deferred FK checks.

> The lesson worth keeping: every sanity check in this workflow passed on a
> backup that could not be restored. Checking that a dump *looks* right is not
> evidence about recovery. Only a restore is. Re-run this test whenever the
> schema gains a new schema, extension, or FK cycle — the four checks added to
> the workflow catch these five specific faults returning, and nothing more.

---

## Failure modes this workflow deliberately has

- **It fails rather than producing a plaintext dump.** No `BACKUP_AGE_RECIPIENT`
  means no run, not an unencrypted artifact.
- **It fails rather than producing a small one.** A data dump under 200 KB, or
  one with no `COPY` blocks, or a schema missing the CRM tables, is treated as a
  failed run. A schema-only file with a data filename is the classic backup that
  turns out to hold nothing.
- **It checks the artifact is really encrypted** before uploading, by looking for
  the `age-encryption.org` header.

None of these prove a restore works. They prove the file is not obviously
useless, which is a different and much weaker claim — deliberately stated that
way so nobody reads a green run as "recovery is proven".
