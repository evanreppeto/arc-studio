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
| **RTO** (time to recover) | minutes for a 29 MB database, once you have a target to restore into |
| Point-in-time recovery | **no** — cannot rewind to just before a mistake |
| Retention | 90 days (GitHub's maximum for artifacts) |
| Storage location | GitHub Actions artifact, `age`-encrypted |

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

```bash
gh run list --workflow backup-prod.yml --limit 10
gh run download <run-id>
```

### 2. Decrypt and unpack

```bash
age -d -i arc-backup.key -o arc-prod.tar.gz arc-prod-<stamp>.tar.gz.age
tar -xzf arc-prod.tar.gz          # roles.sql  schema.sql  data.sql
```

### 3. Restore, in this order

Order matters: roles must exist before the schema that grants to them, and the
schema before the data that fills it.

```bash
psql "$TARGET_DB_URL" -f roles.sql
psql "$TARGET_DB_URL" -f schema.sql
psql "$TARGET_DB_URL" -f data.sql
```

> **Restore into a scratch project first, never straight over prod.** Create a
> new Supabase project, restore there, confirm the data, and only then decide
> what to do with the live one. Restoring onto a database that is still serving
> traffic turns a recoverable incident into two problems.

### 4. Confirm it is real

```sql
select
  (select count(*) from public.organizations) as orgs,
  (select count(*) from public.contacts)      as contacts,
  (select count(*) from public.leads)         as leads,
  (select count(*) from public.campaigns)     as campaigns;
```

Compare against what prod had. For reference, on 2026-07-30 prod held 2 orgs and
a 29 MB database across 113 public tables.

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

## Testing the restore

**A backup that has never been restored is a hypothesis.** BSR-532's acceptance
asks for a restore performed and timed, and that has **not been done yet** —
this runbook describes the path, it does not prove it.

To close that out: restore the newest backup into a scratch Supabase project,
time it end to end, and record the real number here. Delete the scratch project
afterwards. On a 29 MB database expect minutes, but expect it *measured* rather
than assumed — the recovery time is the number that matters in an incident, and
it is the one nobody has.

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
