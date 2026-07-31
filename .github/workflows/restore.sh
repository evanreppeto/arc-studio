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

echo "==> 1/4 prerequisites (extensions a --schema=public dump omits)"
# Without this, `vector` is absent and knowledge_nodes — Arc's memory — cannot
# be created, taking every object that references it down with it.
[ -s 00-prereq.sql ] && run 00-prereq.sql || echo "    (none in this backup)"

echo "==> 2/4 schema (public + app_private, policies included)"
# app_private must come from the SAME dump so its SECURITY DEFINER functions are
# created before the 138 policies that call them.
#
# ONE error is expected here and is harmless:
#   ERROR:  schema "public" already exists
# Every target already has a public schema. Any OTHER error is real.
run schema.sql

echo "==> 3/4 accounts (auth.users + auth.identities)"
# BEFORE the data: public tables carry foreign keys to auth.users, so loading
# data first fails them all. identities as well as users, or nobody can log in.
if [ -s auth-users.sql ]; then run auth-users.sql; else echo "    (absent — restored data will have no logins)"; fi

echo "==> 4/4 data"
# session_replication_role=replica defers FK checks for the load. campaigns,
# approval_items and campaign_assets reference each other in a cycle, so no
# ordering can satisfy them; without this, 17 tables restore empty.
psql "$TARGET" -v ON_ERROR_STOP=0 -qAt <<SQL >/dev/null
set session_replication_role = replica;
\i data.sql
set session_replication_role = origin;
SQL

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
