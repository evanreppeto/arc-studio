-- Wave 4 Phase B — lock Group B, and finish the write side of the boundary
-- (BSR-717).
--
-- THE GATE: 0 nulls on workspace_id and org_id across all 11 tables, 0 rows
-- written since Phase A. Vacuous again on the traffic half; the static writer
-- audit is the gate, and it is green with an EMPTY known-gaps list for the first
-- time since Wave 1.
--
-- After this, every table the contract classes as workspace-owned is enforced:
-- 112 enforced, 0 pending. The read side is BSR-729 and is NOT closed by this.

-- ── 0. Re-derive anything that arrived since Phase A ───────────────────────
--
-- ⚠️ THIS SECTION EXISTS BECAUSE THIS MIGRATION ALREADY FAILED ON PROD ONCE.
--
-- The gate below read 0 nulls when I wrote it. By the time migrate-prod ran, two
-- arc_messages rows had been written (16:59:45Z, during a Vercel deploy) and the
-- migration correctly aborted:
--
--     ERROR: BSR-717: 2 row(s) in arc_messages still have no workspace_id.
--
-- Nothing was applied — the whole migration is one transaction — so prod was
-- unharmed, which is the gate doing exactly its job.
--
-- But the underlying flaw is in the SHAPE of every Phase B in this series: they
-- gate on a count measured minutes earlier, then lock. On an idle database that
-- works; on a live one it is a race, and Waves 1-3 passed partly on luck. A lock
-- migration must therefore re-run its derivation IN THE SAME TRANSACTION as the
-- lock, so a row written in the gap is placed rather than fatal.
--
-- This does NOT weaken the gate. Anything still unresolved after this still
-- aborts below, and a nonzero count here is raised as a NOTICE — because rows
-- needing a late backfill are evidence that a writer may still not be stamping,
-- which is the thing the gate is really for. Silence would hide it.

do $$
declare
  healed bigint;
begin
  update public.arc_messages m
  set workspace_id = c.workspace_id
  from public.arc_conversations c
  where m.conversation_id = c.id and m.workspace_id is null and c.workspace_id is not null;
  get diagnostics healed = row_count;
  if healed > 0 then
    raise notice 'BSR-717: re-derived workspace_id for % arc_messages row(s) written since Phase A. Check whether the writer is stamping.', healed;
  end if;

  update public.arc_projects p
  set workspace_id = (select w.id from public.workspaces w where w.org_id = p.org_id)
  where p.workspace_id is null
    and (select count(*) from public.workspaces w where w.org_id = p.org_id) = 1;
  get diagnostics healed = row_count;
  if healed > 0 then
    raise notice 'BSR-717: re-derived workspace_id for % arc_projects row(s) since Phase A.', healed;
  end if;

  update public.ai_usage_events e
  set workspace_id = (select w.id from public.workspaces w where w.org_id = e.org_id)
  where e.workspace_id is null
    and e.org_id is not null
    and (select count(*) from public.workspaces w where w.org_id = e.org_id) = 1;
  get diagnostics healed = row_count;
  if healed > 0 then
    raise notice 'BSR-717: re-derived workspace_id for % ai_usage_events row(s) since Phase A.', healed;
  end if;
end $$;

-- ── 1. Refuse to lock a column that still has a NULL ────────────────────────

do $$
declare
  tbl text;
  remaining bigint;
begin
  foreach tbl in array array[
    'arc_conversations', 'arc_messages', 'arc_projects', 'arc_saved_items', 'audit_events',
    'support_requests', 'ai_usage_events', 'connector_usage_events'
  ]
  loop
    execute format('select count(*) from public.%I where workspace_id is null', tbl) into remaining;
    if remaining > 0 then
      raise exception 'BSR-717: % row(s) in % still have no workspace_id.', remaining, tbl;
    end if;
  end loop;

  foreach tbl in array array[
    'ai_usage_events', 'connector_usage_events', 'connector_spend_budgets',
    'workspace_connectors', 'workspace_media_config'
  ]
  loop
    execute format('select count(*) from public.%I where org_id is null', tbl) into remaining;
    if remaining > 0 then
      raise exception 'BSR-717: % row(s) in % still have no org_id.', remaining, tbl;
    end if;
  end loop;
end $$;

-- ── 2. The lock ─────────────────────────────────────────────────────────────

alter table public.arc_conversations      alter column workspace_id set not null;
alter table public.arc_messages           alter column workspace_id set not null;
alter table public.arc_projects           alter column workspace_id set not null;
alter table public.arc_saved_items        alter column workspace_id set not null;
alter table public.audit_events           alter column workspace_id set not null;
alter table public.support_requests       alter column workspace_id set not null;
alter table public.ai_usage_events        alter column workspace_id set not null;
alter table public.connector_usage_events alter column workspace_id set not null;

-- The four workspace-first tables never had a NOT NULL org_id.
alter table public.ai_usage_events         alter column org_id set not null;
alter table public.connector_usage_events  alter column org_id set not null;
alter table public.connector_spend_budgets alter column org_id set not null;
alter table public.workspace_connectors    alter column org_id set not null;
alter table public.workspace_media_config  alter column org_id set not null;

-- ── 3. A LATENT SHARING BUG, fixed before it can bite ──────────────────────
--
-- `arc_conversations_viewer_select` and `arc_projects_viewer_select` each grant
-- access through an explicit share with:
--
--     exists (select 1 from arc_conversation_shares s
--              where s.conversation_id = s.id and s.user_id = auth.uid())
--
-- `s.conversation_id = s.id` compares the SHARE ROW's foreign key to its own
-- primary key. Two independent uuids, so it is never true — the share clause
-- grants nothing. `arc_messages_viewer_select` has the correct form
-- (`s.conversation_id = c.id`), which is what the other two meant.
--
-- Latent today, hidden twice over: there are 0 share rows on prod, AND the
-- permissive `*_org_member_select` policy grants every org member SELECT on
-- everything anyway, so nothing could notice. Fixed here regardless — a clause
-- that can never be true is wrong under any policy set, and the day someone
-- shares a conversation it would deny them silently.

-- ── 3a. …and a LIVE policy recursion, fixed by the same change ───────────
--
-- Writing the share clause correctly is not enough. `arc_conversation_shares`
-- has its own SELECT policy that reads `arc_conversations` (to let a
-- conversation's owner see its shares), so a conversation policy that reads
-- shares closes a cycle:
--
--     arc_conversations -> arc_conversation_shares -> arc_conversations
--
-- Postgres answers that with `42P17: infinite recursion detected in policy`.
--
-- ⚠️ THIS IS NOT HYPOTHETICAL AND NOT INTRODUCED HERE. Reading
-- `arc_conversations` as an authenticated member against the CURRENT live schema
-- fails with 42P17 today — verified on prod before writing this. It is masked
-- only because the app's server-side reads use the service role, which bypasses
-- RLS entirely; any read that actually goes through a policy errors.
--
-- The fix is the pattern the schema already uses for exactly this: a
-- SECURITY DEFINER helper, which runs as its owner and therefore does not
-- re-enter RLS. `app_private.is_workspace_member` and friends are all defined
-- this way; these two join them.

create or replace function app_private.has_conversation_share(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.arc_conversation_shares s
    where s.conversation_id = target_conversation_id and s.user_id = auth.uid()
  );
$$;

create or replace function app_private.has_project_share(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.arc_project_shares s
    where s.project_id = target_project_id and s.user_id = auth.uid()
  );
$$;

revoke all on function app_private.has_conversation_share(uuid) from public;
revoke all on function app_private.has_project_share(uuid) from public;
grant execute on function app_private.has_conversation_share(uuid) to authenticated;
grant execute on function app_private.has_project_share(uuid) to authenticated;

drop policy if exists arc_conversations_viewer_select on public.arc_conversations;
create policy arc_conversations_viewer_select on public.arc_conversations
  as permissive for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (visibility = 'workspace' and (select app_private.is_workspace_member(workspace_id)))
    or (select app_private.has_conversation_share(arc_conversations.id))
  );

drop policy if exists arc_projects_viewer_select on public.arc_projects;
create policy arc_projects_viewer_select on public.arc_projects
  as permissive for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (visibility = 'workspace' and (select app_private.is_workspace_member(workspace_id)))
    or (select app_private.has_project_share(arc_projects.id))
  );

-- ── 4. The org-wide reads on the arc_* tables STAY, and that is a decision ──
--
-- RLS policies are OR'd, so the permissive `*_org_member_select` beside each
-- `viewer_select` means the narrow one never decides anything: any org member
-- reads every conversation, message and project regardless of owner, visibility
-- or share. Dropping it is what would make the sharing model real, and the first
-- draft of this migration did exactly that.
--
-- Measured before shipping it, as a real member on prod:
--
--                    org policy kept   org policy dropped
--   conversations                 21                   20
--   projects                       5                    0
--
-- Every row on prod is `visibility = 'private'`, and this member owns 20 of the
-- conversations and NONE of the projects. So dropping it does not narrow a
-- tenancy boundary — both numbers are already inside one workspace — it changes
-- who may read a colleague's PRIVATE conversation. That is a product decision
-- about the sharing model, not a tenancy lock, and it belongs to whoever owns
-- that feature. Same call Wave 3 made for the Brain: a lock migration does not
-- change access posture.
--
-- The bug fixes above are kept because they change no posture while these
-- policies remain: the recursion is removed either way, and a share clause that
-- can never be true is wrong under any policy set.

-- These two have no viewer policy of their own, and no sharing semantics —
-- narrowing them org -> workspace is the ordinary Phase B change.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['arc_saved_items', 'support_requests']
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_org_member_select', tbl);
    execute format(
      'create policy %I on public.%I as permissive for select to authenticated using ((select app_private.is_workspace_member(workspace_id)))',
      tbl || '_workspace_member_select', tbl);
  end loop;
end $$;

-- audit_events already branched on whether workspace_id was null. It cannot be
-- null any more, so the org branch is dead code that would quietly widen the
-- policy if a null ever reappeared. Collapse it to the workspace check.
drop policy if exists audit_events_member_select on public.audit_events;
create policy audit_events_workspace_member_select on public.audit_events
  as permissive for select to authenticated
  using ((select app_private.is_workspace_member(workspace_id)));

-- ── 5. Deliberately untouched ──────────────────────────────────────────────
--
-- ai_usage_events, workspace_connectors and workspace_media_config have RLS
-- enabled and NO policy; connector_usage_events and connector_spend_budgets
-- carry the `*_current_org` policy keyed on current_setting('app.current_org'),
-- a GUC nothing in src/ or apps/ ever sets. All five are service-role-only in
-- practice. Giving any of them an is_workspace_member policy would OPEN data
-- that is closed today — a change of posture, not a lock. Same call as Wave 3
-- made for the Brain; tracked with the read-side work in BSR-729.
