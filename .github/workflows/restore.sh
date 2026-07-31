#!/usr/bin/env bash
#
# Restore an Arc prod backup into a TARGET database.
#
# This script is copied into every backup tarball on purpose. A recovery
# procedure that lives only in a doc is one you have to find during the
# incident; this one arrives with the bytes it knows how to restore.
#
# Usage:
#   ./restore.sh "postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres"
#
# Restore into a SCRATCH project first, never over a live one. Restoring onto a
# database that is still serving traffic turns a recoverable incident into two.
#
# The order below is not cosmetic — it was established by an actual restore on
# 2026-07-31 (BSR-532), where the obvious order produced 0 campaigns and no
# accounts. Each step says what breaks without it.

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <target-database-url>" >&2
  exit 2
fi

cd "$(dirname "$0")"
for f in schema.sql data.sql; do
  [ -s "$f" ] || { echo "missing or empty: $f — is this an unpacked backup?" >&2; exit 1; }
done

run() { psql "$TARGET" -v ON_ERROR_STOP=0 -q -f "$1"; }

echo "==> 1/5 prerequisites (extensions a --schema=public dump omits)"
# Without this, `vector` is absent and knowledge_nodes — Arc's memory — cannot
# be created, taking every object that references it down with it.
[ -s 00-prereq.sql ] && run 00-prereq.sql || echo "    (none in this backup)"

echo "==> 2/5 schema (public + app_private, policies included)"
# app_private must come from the SAME dump so its SECURITY DEFINER functions are
# created before the 138 policies that call them.
#
# ONE error is expected here and is harmless:
#   ERROR:  schema "public" already exists
# Every target already has a public schema. Any OTHER error is real.
run schema.sql

echo "==> 3/5 accounts (auth.users + auth.identities)"
# BEFORE the data: public tables carry foreign keys to auth.users, so loading
# data first fails them all. identities as well as users, or nobody can log in.
if [ -s auth-users.sql ]; then run auth-users.sql; else echo "    (absent — restored data will have no logins)"; fi

echo "==> 4/5 data"
# session_replication_role=replica defers FK checks for the load. campaigns,
# approval_items and campaign_assets reference each other in a cycle, so no
# ordering can satisfy them; without this, 17 tables restore empty.
psql "$TARGET" -v ON_ERROR_STOP=0 -qAt <<SQL >/dev/null
set session_replication_role = replica;
\i data.sql
set session_replication_role = origin;
SQL

echo "==> 5/5 storage objects"
# The database dump carries storage.objects METADATA. Without this step the
# restore comes up with rows describing files that do not exist — which looks
# fine until someone opens a campaign and the image 404s.
#
# Reading the bytes needed no credential (the bucket is public); WRITING them
# does. Set these and re-run to restore storage:
#   export SUPABASE_URL="https://<ref>.supabase.co"
#   export SUPABASE_SERVICE_ROLE_KEY="<service role key>"
if [ ! -s storage-manifest.json ]; then
  echo "    (no storage manifest in this backup)"
elif [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${SUPABASE_URL:-}" ]; then
  echo "    SKIPPED — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set." >&2
  echo "    The database is restored but every stored file is still missing." >&2
  echo "    Export both and re-run this script to upload them." >&2
else
  python3 - <<'UPLOAD'
import json, os, pathlib, sys, urllib.error, urllib.parse, urllib.request

base = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
auth = {"Authorization": f"Bearer {key}", "apikey": key}
manifest = json.load(open("storage-manifest.json"))

def call(method, path, data=None, headers=None, ctype=None):
    req = urllib.request.Request(f"{base}{path}", data=data, method=method)
    for k, v in {**auth, **(headers or {})}.items():
        req.add_header(k, v)
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

for bucket in sorted({e["bucket"] for e in manifest}):
    public = any(e["public"] for e in manifest if e["bucket"] == bucket)
    body = json.dumps({"id": bucket, "name": bucket, "public": public}).encode()
    status, payload = call("POST", "/storage/v1/bucket", body, ctype="application/json")
    # 409 = already there, which is the normal case on a re-run.
    if status not in (200, 201, 409):
        print(f"    could not create bucket {bucket}: HTTP {status} {payload[:200]!r}", file=sys.stderr)

done = skipped = 0
for entry in manifest:
    if entry.get("status") != "ok":
        skipped += 1
        continue
    src = pathlib.Path("storage") / entry["bucket"] / entry["name"]
    if not src.exists():
        print(f"    MISSING from backup: {entry['bucket']}/{entry['name']}", file=sys.stderr)
        skipped += 1
        continue
    quoted = urllib.parse.quote(entry["name"], safe="/")
    status, payload = call(
        "POST", f"/storage/v1/object/{entry['bucket']}/{quoted}",
        src.read_bytes(),
        headers={"x-upsert": "true"},          # re-runnable
        ctype=entry.get("mime") or "application/octet-stream",
    )
    if status in (200, 201):
        done += 1
    else:
        print(f"    FAILED {entry['bucket']}/{entry['name']}: HTTP {status} {payload[:200]!r}", file=sys.stderr)

print(f"    uploaded {done}, skipped {skipped}, of {len(manifest)}")
if skipped:
    print("    (skipped entries are private-bucket objects whose bytes were never backed up)")
UPLOAD
fi

echo
echo "==> verifying"
psql "$TARGET" -qAt <<'SQL'
select 'policies        ' || count(*) from pg_policies where schemaname='public'
union all select 'organizations   ' || count(*) from public.organizations
union all select 'contacts        ' || count(*) from public.contacts
union all select 'leads           ' || count(*) from public.leads
union all select 'campaigns       ' || count(*) from public.campaigns
union all select 'approval_items  ' || count(*) from public.approval_items
union all select 'knowledge_nodes ' || count(*) from public.knowledge_nodes
union all select 'auth.users      ' || count(*) from auth.users
union all select 'auth.identities ' || count(*) from auth.identities;
SQL

# Deferring FK checks loads the cycle, but it also means nothing validated the
# references. Prove there are no dangling ones rather than assuming.
DANGLING=$(psql "$TARGET" -qAt -c "select count(*) from public.campaigns c left join public.approval_items a on a.id = c.approval_item_id where c.approval_item_id is not null and a.id is null;")
if [ "${DANGLING:-1}" = "0" ]; then
  echo "referential integrity OK (FK checks were deferred for the load)"
else
  echo "WARNING: ${DANGLING} campaigns reference an approval_item that did not restore." >&2
fi

cat <<'EOF'

Compare those against what prod held. A zero in campaigns, knowledge_nodes or
auth.users means a step above did not take — re-read the output, do not treat
the restore as done.

Row counts prove the bytes arrived, not that the app can read them. Point a
deployment at this database and load /crm before calling the recovery good.
EOF
