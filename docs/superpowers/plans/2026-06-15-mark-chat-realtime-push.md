# Mark Chat Realtime Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Mark chat sub-second replies by having the Mac mini runner subscribe to Supabase Realtime `INSERT`s on `agent_tasks` (outbound socket, no tunnel), replacing the dead ephemeral-tunnel webhook push.

**Architecture:** The app already inserts a queued `agent_tasks` row on every operator message. A new Mac mini component opens an outbound WebSocket to Supabase, receives that insert in sub-second time, claims the task with a compare-and-set, runs Mark's existing turn, and POSTs the reply back through the already-working app API. The poller stays as the safety net; everything is idempotent so the two paths never double-answer.

**Tech Stack:** Python 3 (stdlib + `realtime` realtime-py client), Supabase Realtime (Postgres Changes), Supabase REST (PostgREST) for the CAS claim, a SQL migration, Node (existing diagnostic script), `launchd` for auto-start.

---

## File structure

- `supabase/migrations/20260615170000_agent_tasks_realtime_publication.sql` — **create**: add `public.agent_tasks` to the `supabase_realtime` publication (idempotent).
- `mark-runner/mark_chat_core.py` — **create**: pure, unit-tested helpers — `row_to_message`, `is_chat_task`, `extract_record`, `build_claim_request`, `claim_won`, `claim_task`.
- `mark-runner/test_mark_chat_core.py` — **create**: stdlib `unittest` tests for the pure helpers.
- `mark-runner/realtime_subscriber.py` — **create**: thin glue wiring realtime-py → core → the configured worker module.
- `mark-runner/com.bsr.mark-realtime.plist` — **create**: `launchd` job (auto-start + restart).
- `mark-runner/requirements.txt` — **modify**: add `realtime`.
- `mark-runner/.env.example` — **modify**: add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MARK_WORKER_MODULE`.
- `mark-runner/README.md` — **modify**: document the realtime subscriber + phasing.
- `scripts/diagnose-hermes-connection.mjs` — **modify**: finalize as the supported diagnostic.
- `package.json` — **modify**: add `diagnose:hermes` script.

---

## Task 1: Pre-flight — verify RLS and current publication state

No code. This decides whether the migration is a real change or a no-op, and confirms it's safe to add the table to the realtime publication.

- [ ] **Step 1: Run the introspection SQL**

Run in the Supabase SQL editor (Dashboard → SQL) for project `qqbecyrhnowmooyjiztz`, or via the `supabase` MCP:

```sql
-- Is RLS enabled on agent_tasks? (expect rowsecurity = true)
select relname, relrowsecurity as rls_enabled, relreplident as replica_identity
from pg_class
where relname = 'agent_tasks' and relnamespace = 'public'::regnamespace;

-- Is agent_tasks already in the realtime publication? (expect 0 rows = not yet)
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'agent_tasks';
```

- [ ] **Step 2: Interpret**

Expected / required:
- `rls_enabled = true`. If it is `false`, STOP and flag it — adding the table to the publication would expose rows to any anon subscriber. (The service-role subscriber would still work, but we don't want anon exposure.) Resolution if false: keep the table out of the publication is not an option (Realtime needs it), so instead enable RLS (`alter table public.agent_tasks enable row level security;`) with no anon `select` policy before Task 2. Record the finding.
- `replica_identity` = `d` (default) is fine — INSERT events always carry the full new row regardless of replica identity. No change needed.
- If `pg_publication_tables` already returns `agent_tasks`, Task 2's migration is a safe no-op (kept anyway as the source-of-truth record).

No commit (read-only investigation).

---

## Task 2: Migration — add agent_tasks to the realtime publication

**Files:**
- Create: `supabase/migrations/20260615170000_agent_tasks_realtime_publication.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Broadcast agent_tasks inserts over Supabase Realtime so the Mark/Hermes runner
-- can receive queued chat tasks instantly (outbound socket) instead of via an
-- inbound webhook tunnel. INSERT events carry the full new row under default
-- replica identity, so no replica-identity change is required.
--
-- Idempotent: only adds the table if it isn't already published. RLS must remain
-- enabled on agent_tasks (verified in pre-flight) so non-service-role subscribers
-- receive nothing without an explicit policy.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.agent_tasks';
  end if;
end
$$;
```

- [ ] **Step 2: Apply to the database**

Apply the same way other migrations in this repo reach prod (manual — see the `vercel-deploy` note: migrations are applied to the prod DB by hand). Run the file's SQL in the Supabase SQL editor against project `qqbecyrhnowmooyjiztz`.

- [ ] **Step 3: Verify it took**

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'agent_tasks';
```

Expected: one row (`agent_tasks`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615170000_agent_tasks_realtime_publication.sql
git commit -m "feat(realtime): publish agent_tasks for Mark chat instant delivery"
```

---

## Task 3: Pure core helpers — row mapping & payload extraction

**Files:**
- Create: `mark-runner/mark_chat_core.py`
- Test: `mark-runner/test_mark_chat_core.py`

- [ ] **Step 1: Write the failing tests**

```python
# mark-runner/test_mark_chat_core.py
import unittest

from mark_chat_core import row_to_message, is_chat_task, extract_record


class RowToMessage(unittest.TestCase):
    def test_maps_full_row(self):
        row = {
            "id": "task-1",
            "objective": "Find partner leads.",
            "created_at": "2026-06-15T16:00:00Z",
            "task_type": "mark_chat_message",
            "metadata": {
                "conversation_id": "conv-1",
                "mentions": [{"type": "campaign", "id": "c1"}],
                "requested_by": "evan@example.com",
                "command": "find-leads",
                "attachments": [{"url": "https://x/y.png"}],
                "model_route": "fast",
                "mode": "ask",
            },
        }
        msg = row_to_message(row)
        self.assertEqual(msg["agentTaskId"], "task-1")
        self.assertEqual(msg["conversationId"], "conv-1")
        self.assertEqual(msg["message"], "Find partner leads.")
        self.assertEqual(msg["operator"], "evan@example.com")
        self.assertEqual(msg["mentions"], [{"type": "campaign", "id": "c1"}])
        self.assertEqual(msg["command"], "find-leads")
        self.assertEqual(msg["attachments"], [{"url": "https://x/y.png"}])
        self.assertEqual(msg["route"], "fast")
        self.assertEqual(msg["mode"], "ask")
        self.assertEqual(msg["createdAt"], "2026-06-15T16:00:00Z")

    def test_defaults_when_metadata_missing(self):
        msg = row_to_message({"id": "t", "objective": "hi", "metadata": None})
        self.assertEqual(msg["conversationId"], "")
        self.assertEqual(msg["operator"], "Operator")
        self.assertEqual(msg["mentions"], [])
        self.assertEqual(msg["attachments"], [])
        self.assertEqual(msg["route"], "fast")
        self.assertEqual(msg["mode"], "act")
        self.assertIsNone(msg["command"])

    def test_message_falls_back_to_human_instruction(self):
        msg = row_to_message({"id": "t", "objective": None,
                              "metadata": {"human_instruction": "from meta"}})
        self.assertEqual(msg["message"], "from meta")


class IsChatTask(unittest.TestCase):
    def test_true_for_chat_task(self):
        self.assertTrue(is_chat_task({"task_type": "mark_chat_message"}))

    def test_false_for_other(self):
        self.assertFalse(is_chat_task({"task_type": "campaign_strategy"}))
        self.assertFalse(is_chat_task({}))


class ExtractRecord(unittest.TestCase):
    def test_record_key(self):
        self.assertEqual(extract_record({"record": {"id": "a"}}), {"id": "a"})

    def test_nested_data_record(self):
        self.assertEqual(extract_record({"data": {"record": {"id": "b"}}}), {"id": "b"})

    def test_new_key(self):
        self.assertEqual(extract_record({"new": {"id": "c"}}), {"id": "c"})

    def test_empty_when_unrecognized(self):
        self.assertEqual(extract_record({"nope": 1}), {})
        self.assertEqual(extract_record("not-a-dict"), {})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mark-runner && python3 -m unittest test_mark_chat_core -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mark_chat_core'`.

- [ ] **Step 3: Write the helpers**

```python
# mark-runner/mark_chat_core.py
"""Pure, dependency-free helpers shared by the realtime subscriber.

Kept separate from the realtime/HTTP glue so the logic that can actually be
wrong — row→message mapping, exactly-once claim shaping — is unit-tested without
a live socket or network. Mirrors toInboxItem() in src/lib/mark-chat/inbox.ts.
"""
import json


def is_chat_task(record):
    """True only for operator chat tasks (defensive — the realtime filter already
    restricts task_type=mark_chat_message, but updates/replays shouldn't slip through)."""
    return isinstance(record, dict) and record.get("task_type") == "mark_chat_message"


def extract_record(payload):
    """Pull the new row out of a realtime postgres_changes payload, tolerating the
    handful of shapes different realtime-py versions deliver."""
    if not isinstance(payload, dict):
        return {}
    if isinstance(payload.get("record"), dict):
        return payload["record"]
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("record"), dict):
        return data["record"]
    if isinstance(payload.get("new"), dict):
        return payload["new"]
    return {}


def row_to_message(record):
    """Map an agent_tasks row to the dict shape generate_reply()/deliver() expect
    (same fields the poller's inbox items carry, plus routing hints)."""
    meta = record.get("metadata") or {}
    return {
        "agentTaskId": record.get("id"),
        "conversationId": meta.get("conversation_id", ""),
        "message": record.get("objective") or meta.get("human_instruction", ""),
        "mentions": meta.get("mentions", []) or [],
        "operator": meta.get("requested_by", "Operator"),
        "command": meta.get("command"),
        "attachments": meta.get("attachments", []) or [],
        "route": meta.get("model_route", "fast"),
        "mode": meta.get("mode", "act"),
        "createdAt": record.get("created_at"),
    }
```

(`json` import is used by the claim helpers added in Task 4 — leave it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mark-runner && python3 -m unittest test_mark_chat_core -v`
Expected: PASS (the `claim` tests don't exist yet; all current tests green).

- [ ] **Step 5: Commit**

```bash
git add mark-runner/mark_chat_core.py mark-runner/test_mark_chat_core.py
git commit -m "feat(mark-runner): pure helpers for realtime row→message mapping"
```

---

## Task 4: Compare-and-set claim against Supabase REST

**Files:**
- Modify: `mark-runner/mark_chat_core.py`
- Test: `mark-runner/test_mark_chat_core.py`

The subscriber must claim a task `queued → running` so it never double-answers with the poller. There's no claim-by-id app endpoint (the app claims inside its inbox GET), so the subscriber claims directly via PostgREST using its service-role key — a CAS via the `status=eq.queued` filter. We split the request *shaping* (pure, tested) from the network call (thin).

- [ ] **Step 1: Write the failing tests (append to test_mark_chat_core.py)**

```python
from mark_chat_core import build_claim_request, claim_won


class BuildClaimRequest(unittest.TestCase):
    def test_targets_only_queued_row(self):
        url, body, headers = build_claim_request(
            "task-9", "https://ref.supabase.co/", "svc-key", "2026-06-15T16:00:00+00:00"
        )
        self.assertEqual(
            url,
            "https://ref.supabase.co/rest/v1/agent_tasks?id=eq.task-9&status=eq.queued",
        )
        parsed = json.loads(body.decode("utf-8"))
        self.assertEqual(parsed["status"], "running")
        self.assertEqual(parsed["started_at"], "2026-06-15T16:00:00+00:00")
        self.assertEqual(headers["apikey"], "svc-key")
        self.assertEqual(headers["authorization"], "Bearer svc-key")
        self.assertEqual(headers["prefer"], "return=representation")


class ClaimWon(unittest.TestCase):
    def test_won_when_a_row_returned(self):
        self.assertTrue(claim_won([{"id": "task-9"}]))

    def test_lost_when_empty(self):
        self.assertFalse(claim_won([]))
        self.assertFalse(claim_won(None))
        self.assertFalse(claim_won({"unexpected": "shape"}))
```

Add `import json` at the top of `test_mark_chat_core.py` (the new claim tests use `json.loads`).

- [ ] **Step 2: Run to verify failure**

Run: `cd mark-runner && python3 -m unittest test_mark_chat_core -v`
Expected: FAIL — `ImportError: cannot import name 'build_claim_request'`.

- [ ] **Step 3: Implement (append to mark_chat_core.py)**

```python
import os
import urllib.request
from datetime import datetime, timezone


def build_claim_request(task_id, supabase_url, service_key, now_iso):
    """Shape the PostgREST CAS request: update this row to running ONLY while it's
    still queued. An empty result set means another path already claimed it."""
    base = supabase_url.rstrip("/")
    url = f"{base}/rest/v1/agent_tasks?id=eq.{task_id}&status=eq.queued"
    body = json.dumps({"status": "running", "started_at": now_iso}).encode("utf-8")
    headers = {
        "apikey": service_key,
        "authorization": f"Bearer {service_key}",
        "content-type": "application/json",
        "prefer": "return=representation",
    }
    return url, body, headers


def claim_won(response_json):
    """The CAS won iff PostgREST returned the (one) updated row."""
    return isinstance(response_json, list) and len(response_json) > 0


def claim_task(task_id, supabase_url=None, service_key=None):
    """Atomically claim queued→running. Returns True iff this caller won the claim.
    Thin network wrapper around build_claim_request/claim_won."""
    supabase_url = supabase_url or os.environ["SUPABASE_URL"]
    service_key = service_key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    now_iso = datetime.now(timezone.utc).isoformat()
    url, body, headers = build_claim_request(task_id, supabase_url, service_key, now_iso)
    req = urllib.request.Request(url, data=body, method="PATCH", headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read().decode("utf-8")
    return claim_won(json.loads(raw) if raw else [])
```

- [ ] **Step 4: Run to verify pass**

Run: `cd mark-runner && python3 -m unittest test_mark_chat_core -v`
Expected: PASS (all classes).

- [ ] **Step 5: Commit**

```bash
git add mark-runner/mark_chat_core.py mark-runner/test_mark_chat_core.py
git commit -m "feat(mark-runner): CAS claim helper for exactly-once chat handling"
```

---

## Task 5: Realtime subscriber glue

**Files:**
- Create: `mark-runner/realtime_subscriber.py`

Thin async glue: subscribe to inserts, hand each off to a worker thread (claim → generate_reply → deliver). Blocking work runs off the event loop in a daemon thread, exactly like `webhook.py` does, so the socket keeps receiving.

- [ ] **Step 1: Write the subscriber**

```python
#!/usr/bin/env python3
"""
Lowest-latency receiver for the BSR growth engine <-> Mark (Hermes) chat.

Opens an OUTBOUND WebSocket to Supabase Realtime and subscribes to INSERTs on
public.agent_tasks (task_type = mark_chat_message). The instant the app queues a
message, Supabase pushes it here; we claim it (queued->running, compare-and-set),
run Mark's turn, and POST the reply back to the app. No tunnel, no public URL —
the socket is outbound, so it traverses home NAT and reconnects on its own.

    app inserts agent_tasks (queued)            [already built]
      -> Supabase Realtime push  -->  this subscriber
      -> claim_task() (CAS)       -->  generate_reply()  -->  deliver()

Keep poller.py running underneath as the safety net for anything missed while
this process is down. Replies are idempotent per agentTaskId (a late duplicate
404s), and the CAS claim means the poller and this path never double-answer.

Mark's turn (generate_reply) and reply delivery (deliver) are imported from the
worker module named by MARK_WORKER_MODULE (default "poller"), matching webhook.py.

Env (see .env.example):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (realtime + CAS claim)
    APP_BASE_URL, HERMES_AGENT_API_TOKEN      (used by the worker's deliver())
    MARK_WORKER_MODULE                        (default "poller")

Run:
    set -a; . ./.env; set +a
    python3 realtime_subscriber.py
"""
import asyncio
import importlib
import os
import sys
import threading

from realtime import AsyncRealtimeClient, RealtimeSubscribeStates

from mark_chat_core import claim_task, extract_record, is_chat_task, row_to_message

WORKER_MODULE = os.environ.get("MARK_WORKER_MODULE", "poller")
_worker = importlib.import_module(WORKER_MODULE)
generate_reply = _worker.generate_reply
deliver = _worker.deliver


def _process(record):
    """Claim → answer → deliver, off the event loop thread."""
    msg = row_to_message(record)
    task_id = msg.get("agentTaskId")
    if not task_id:
        return
    try:
        if not claim_task(task_id):
            return  # poller or another path already took it
    except Exception as err:  # noqa: BLE001 - a claim failure should not crash the loop
        print(f"[mark-realtime] claim failed {task_id}: {err}", file=sys.stderr)
        return
    try:
        reply = generate_reply(msg)
        deliver(task_id, reply, "complete")
        print(f"[mark-realtime] replied to {task_id}")
    except Exception as err:  # noqa: BLE001 - any failure becomes a failed reply
        try:
            deliver(task_id, f"Mark couldn't complete this reply: {err}", "failed")
        except Exception as deliver_err:  # noqa: BLE001
            print(f"[mark-realtime] deliver-failed {task_id}: {deliver_err}", file=sys.stderr)
        print(f"[mark-realtime] failed {task_id}: {err}", file=sys.stderr)


def _on_insert(payload):
    record = extract_record(payload)
    if not is_chat_task(record):
        return
    threading.Thread(target=_process, args=(record,), daemon=True).start()


async def main():
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not service_key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("APP_BASE_URL") or not os.environ.get("HERMES_AGENT_API_TOKEN"):
        print("APP_BASE_URL and HERMES_AGENT_API_TOKEN must be set (used by deliver())", file=sys.stderr)
        sys.exit(1)

    ws_url = supabase_url.replace("https://", "wss://").replace("http://", "ws://") + "/realtime/v1"
    socket = AsyncRealtimeClient(ws_url, service_key, auto_reconnect=True)
    await socket.connect()

    channel = socket.channel("mark-chat")
    channel.on_postgres_changes(
        "INSERT",
        schema="public",
        table="agent_tasks",
        filter="task_type=eq.mark_chat_message",
        callback=_on_insert,
    )
    await channel.subscribe(
        lambda state, err: print(
            f"[mark-realtime] subscription: {state}"
            + (f" err={err}" if err else "")
            + (" — listening for chat tasks" if state == RealtimeSubscribeStates.SUBSCRIBED else "")
        )
    )

    # Keep the process alive so the client services the socket + heartbeats.
    # AsyncRealtimeClient exposes a listen()/_listen() loop in current versions;
    # fall back to parking forever if this build doesn't.
    listen = getattr(socket, "listen", None) or getattr(socket, "_listen", None)
    if callable(listen):
        await listen()
    else:
        await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
```

- [ ] **Step 2: Import-check it (no live socket yet)**

Confirm the module imports and the worker resolves. With the repo's stub `poller.py`, `generate_reply` exists (it raises `NotImplementedError` when called, which is fine for an import check). The `realtime` package must be installed first (Task 6).

Run (after Task 6's install, or in the same venv): `cd mark-runner && python3 -c "import realtime_subscriber; print('import ok')"`
Expected: `import ok` (no syntax/import errors).

- [ ] **Step 3: Commit**

```bash
git add mark-runner/realtime_subscriber.py
git commit -m "feat(mark-runner): Supabase Realtime subscriber for instant chat"
```

---

## Task 6: Dependency, env, and docs

**Files:**
- Modify: `mark-runner/requirements.txt`
- Modify: `mark-runner/.env.example`
- Modify: `mark-runner/README.md`

- [ ] **Step 1: Add the dependency**

Replace `mark-runner/requirements.txt` with:

```text
# mcp_server.py needs `mcp`; realtime_subscriber.py needs `realtime` (the Supabase
# realtime-py client). poller.py and webhook.py remain stdlib-only.
mcp>=1.2.0
realtime>=2.0.0
```

- [ ] **Step 2: Install it**

Run: `cd mark-runner && python3 -m pip install -r requirements.txt`
Expected: `realtime` and `mcp` installed (or already satisfied).

- [ ] **Step 3: Extend .env.example**

Append to `mark-runner/.env.example`:

```text

# --- Phase 3 (realtime push) — used by realtime_subscriber.py for instant replies ---
# The subscriber opens an OUTBOUND WebSocket to Supabase (no public URL / tunnel
# needed) and subscribes to agent_tasks inserts. SUPABASE_URL is your project URL;
# the service-role key authorizes the realtime subscription and the CAS claim and
# lives only on this trusted host.
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
# Module exposing generate_reply(message) and deliver(agentTaskId, text, status).
# Defaults to the reference poller; point it at Mark's real worker module if different.
MARK_WORKER_MODULE=poller
```

- [ ] **Step 4: Document it in README.md**

Insert after the "Run the poller" section in `mark-runner/README.md`:

````markdown
## Run the realtime subscriber (lowest latency)

```bash
cp .env.example .env        # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ APP_BASE_URL, HERMES_AGENT_API_TOKEN)
pip install -r requirements.txt
set -a; . ./.env; set +a
python3 realtime_subscriber.py
```

The subscriber holds an outbound WebSocket to Supabase and answers each operator
message the instant it's queued — no public URL, no tunnel, no signatures. It
imports Mark's turn (`generate_reply`) and reply delivery (`deliver`) from
`MARK_WORKER_MODULE` (default `poller`); set that env var if Mark's worker lives
in another module. Keep the poller running too (cron) as the safety net — the CAS
claim and idempotent replies guarantee the two paths never double-answer.
````

Update the "Phasing" section's list to add:

```markdown
- **Now (lowest latency):** run `realtime_subscriber.py` — outbound socket to
  Supabase, sub-second replies, nothing inbound to expose. Keep the poller as the
  safety net. (Supersedes the webhook-push phase, which needed a public tunnel.)
```

- [ ] **Step 5: Commit**

```bash
git add mark-runner/requirements.txt mark-runner/.env.example mark-runner/README.md
git commit -m "docs(mark-runner): realtime subscriber setup + realtime dependency"
```

---

## Task 7: launchd auto-start

**Files:**
- Create: `mark-runner/com.bsr.mark-realtime.plist`

- [ ] **Step 1: Write the plist**

Replace `__MARK_RUNNER_DIR__` and `__PYTHON__` when installing (instructions in Step 2).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.bsr.mark-realtime</string>

  <!-- Loads .env from the working dir, then runs the subscriber. -->
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>set -a; . ./.env; set +a; exec "__PYTHON__" realtime_subscriber.py</string>
  </array>

  <key>WorkingDirectory</key>
  <string>__MARK_RUNNER_DIR__</string>

  <!-- Restart on crash and start at load/login. -->
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>__MARK_RUNNER_DIR__/mark-realtime.log</string>
  <key>StandardErrorPath</key>
  <string>__MARK_RUNNER_DIR__/mark-realtime.err.log</string>
</dict>
</plist>
```

- [ ] **Step 2: Document install (in the plist header comment + README note)**

Add this note under the README "Run the realtime subscriber" section:

````markdown
### Auto-start on the Mac mini (launchd)

```bash
# From the mark-runner dir, substitute the real paths into the plist:
PYBIN="$(command -v python3)"
sed -e "s#__MARK_RUNNER_DIR__#$(pwd)#g" -e "s#__PYTHON__#${PYBIN}#g" \
  com.bsr.mark-realtime.plist > ~/Library/LaunchAgents/com.bsr.mark-realtime.plist
launchctl load ~/Library/LaunchAgents/com.bsr.mark-realtime.plist
launchctl start com.bsr.mark-realtime
# logs: tail -f mark-realtime.log mark-realtime.err.log
```
````

- [ ] **Step 3: Commit**

```bash
git add mark-runner/com.bsr.mark-realtime.plist mark-runner/README.md
git commit -m "feat(mark-runner): launchd job to auto-start the realtime subscriber"
```

---

## Task 8: Finalize the connection diagnostic

**Files:**
- Modify: `scripts/diagnose-hermes-connection.mjs`
- Modify: `package.json`

The throwaway diagnostic already runs; make it the supported tool (robust `.env.local` path, correct columns) and add a script alias.

- [ ] **Step 1: Replace the script with the finalized version**

```javascript
// Read-only diagnostic for the live Hermes/Mark connection state.
// Usage: pnpm diagnose:hermes  (reads .env.local for Supabase URL + service key)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function loadEnv(path) {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
const env = loadEnv(envPath);
const url =
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.MARKETING_SUPABASE_URL ||
  env.NEXT_PUBLIC_MARKETING_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.MARKETING_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase URL or service role key in .env.local");
  process.exit(1);
}

const base = url.replace(/\/$/, "");
const headers = { apikey: key, authorization: `Bearer ${key}` };

async function q(path, label) {
  try {
    const res = await fetch(`${base}/rest/v1/${path}`, { headers });
    if (!res.ok) return { label, error: `HTTP ${res.status} ${await res.text()}` };
    return { label, rows: await res.json() };
  } catch (e) {
    return { label, error: e?.message ?? String(e) };
  }
}

function show(r) {
  console.log(`\n=== ${r.label} ===`);
  if (r.error) return console.log("  ERROR:", r.error);
  if (!r.rows?.length) return console.log("  (none)");
  console.log(JSON.stringify(r.rows, null, 2));
}

const results = await Promise.all([
  q("agent_connections?select=*", "agent_connections (health / last_seen)"),
  q("agents?select=key,name,status&limit=5", "agents (attached runners)"),
  q("agent_api_tokens?select=id,label,revoked_at,created_at,last_used_at&order=created_at.desc&limit=10", "agent_api_tokens (issued tokens)"),
  q("agent_tasks?select=id,task_type,status,created_at&task_type=eq.mark_chat_message&order=created_at.desc&limit=8", "recent mark_chat_message tasks (settling?)"),
  q("mark_messages?select=id,role,status,created_at&order=created_at.desc&limit=8", "mark_messages (pending vs complete)"),
]);

console.log("Supabase:", base);
for (const r of results) show(r);
console.log("\nEnv flags (.env.local):");
console.log("  HERMES_AGENT_API_TOKEN set?", Boolean(env.HERMES_AGENT_API_TOKEN));
console.log("  SUPABASE_SERVICE_ROLE_KEY set?", Boolean(key));
console.log("  MARK_AGENT_KEY:", env.MARK_AGENT_KEY || "(unset)");
```

- [ ] **Step 2: Add the pnpm script**

In `package.json`, add to `"scripts"`:

```json
"diagnose:hermes": "node scripts/diagnose-hermes-connection.mjs",
```

- [ ] **Step 3: Run it**

Run: `pnpm diagnose:hermes`
Expected: prints `agent_connections` with `last_status: "ok"`, the `mark` agent row, token list, and recent chat tasks — no `ERROR:` lines.

- [ ] **Step 4: Commit**

```bash
git add scripts/diagnose-hermes-connection.mjs package.json
git commit -m "chore: supported pnpm diagnose:hermes connection check"
```

---

## Task 9: Live end-to-end verification

No code — proves the whole path works. Requires Task 2 applied and the subscriber running (locally or on the Mac mini) with a real `generate_reply` (or temporarily a trivial stub that returns a fixed string).

- [ ] **Step 1: Start the subscriber**

On a host with the env set (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL`, `HERMES_AGENT_API_TOKEN`):
Run: `cd mark-runner && set -a; . ./.env; set +a; python3 realtime_subscriber.py`
Expected: logs `subscription: SUBSCRIBED — listening for chat tasks`.

- [ ] **Step 2: Trigger a real message**

Send a message to Mark from the app UI (`/mark`), OR insert a queued task directly against prod with the service key:

```bash
curl -sS -X POST "$SUPABASE_URL/rest/v1/agent_tasks" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "content-type: application/json" -H "prefer: return=representation" \
  -d '{"agent_id":"<mark agent id from diagnose:hermes>","status":"queued","priority":"high","objective":"Realtime smoke test — reply OK","task_type":"mark_chat_message","source_type":"mark_conversation","source_id":"<a real conversation id or omit if UI-sent>","metadata":{"conversation_id":"<conv>","requested_by":"diag","source":"mark_chat","model_route":"fast","mode":"ask","outbound_locked":true}}'
```

(Prefer the UI path — it also creates the pending bubble that the reply settles. The raw insert is for an isolated subscriber test.)

- [ ] **Step 3: Confirm sub-second claim + reply**

Expected within ~1–2s: subscriber logs `replied to <task-id>`. Then:
Run: `pnpm diagnose:hermes`
Expected: the test task shows `status` no longer `queued` (it's `completed`/`running`→settled); for a UI-sent message, the thread shows Mark's reply.

- [ ] **Step 4: Confirm no double-answer**

With the subscriber running AND the poller firing, send one message. Expected: exactly one Mark reply (the loser path's claim returns 0 rows / the duplicate reply 404s). Verify only one `mark` message row was added for that turn via `pnpm diagnose:hermes`.

- [ ] **Step 5: Confirm reconnect**

Kill the subscriber's network briefly (or stop/start it). Send a message while it's down → the poller answers it (safety net). Restart the subscriber → it logs `SUBSCRIBED` again and answers the next message instantly. No code change; this validates the resilience claim.

---

## Notes for the implementer

- **Outbound stays locked throughout.** Nothing in this plan sends/publishes/launches. The subscriber only moves *chat replies* faster; approvals and drafts are untouched.
- **Service-role key handling:** it lives only in the Mac mini's `mark-runner/.env`. Do not commit it; `.env` is already gitignored (only `.env.example` is tracked).
- **realtime-py version drift:** the payload shape and keep-alive method differ slightly across versions — `extract_record` and the `listen`/`_listen` fallback in Task 5 handle both. Step 2 of Task 9 is where you confirm against the installed version; if events arrive but `extract_record` returns `{}`, log one raw payload and adjust the key it reads.
- **Vercel:** confirm `HERMES_AGENT_API_TOKEN` is set in the Vercel project env (the subscriber's `deliver()` posts there). The migration must be applied to the prod DB manually (per repo convention).
