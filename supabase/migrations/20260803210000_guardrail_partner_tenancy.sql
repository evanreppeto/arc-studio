-- Give guardrail_findings and partner_health_snapshots their own tenancy (BSR-653).
--
-- Both were classified "inherits" in the BSR-637 boundary — no scoping column,
-- isolated by a foreign key to a tenant-scoped parent. The BSR-638 contract check
-- rejected both on its first run, correctly: every one of their parent FKs is
-- NULLABLE, so a row can be inserted attached to nothing and belonging to no org
-- and no workspace. guardrail_findings is the worse case — all four parents
-- (guardrail_rule_id, approval_item_id, campaign_asset_id, agent_task_id) are
-- nullable, and it is actively written by src/lib/arc-api/draft-review.ts.
--
-- "Has an FK to a scoped parent" is not the test. "Has a NOT NULL FK to a scoped
-- parent" is.
--
-- Tightening the FKs is the wrong fix: guardrail_findings is deliberately
-- polymorphic — a finding can hang off a rule, an item, an asset, or a task — so
-- forcing any single parent to be NOT NULL would break the design. They get their
-- own columns instead.
--
-- Both tables are EMPTY in prod, so the backfill below is a formality there. It is
-- written properly anyway: this migration also runs against any database that has
-- accumulated rows, and a backfill that silently skips them would leave columns
-- that cannot be made NOT NULL.

-- ── guardrail_findings: workspace-owned (findings about generated drafts) ────

alter table public.guardrail_findings
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- Backfill through whichever parent a row actually has, most specific first.
-- agent_tasks is the only parent carrying a workspace of its own; everything else
-- resolves the org and then the org's sole workspace.
update public.guardrail_findings f
set org_id = t.org_id, workspace_id = t.workspace_id
from public.agent_tasks t
where f.agent_task_id = t.id and f.org_id is null;

update public.guardrail_findings f
set org_id = a.org_id
from public.approval_items a
where f.approval_item_id = a.id and f.org_id is null;

update public.guardrail_findings f
set org_id = ca.org_id
from public.campaign_assets ca
where f.campaign_asset_id = ca.id and f.org_id is null;

update public.guardrail_findings f
set org_id = r.org_id
from public.guardrail_rules r
where f.guardrail_rule_id = r.id and f.org_id is null;

-- Workspace from the org's sole workspace, for rows whose parent had none.
update public.guardrail_findings f
set workspace_id = w.id
from public.workspaces w
where f.workspace_id is null
  and w.org_id = f.org_id
  and (select count(*) from public.workspaces w2 where w2.org_id = f.org_id) = 1;

-- ── partner_health_snapshots: org-owned (derived metrics about CRM records) ──

alter table public.partner_health_snapshots
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;

update public.partner_health_snapshots s
set org_id = c.org_id
from public.companies c
where s.company_id = c.id and s.org_id is null;

update public.partner_health_snapshots s
set org_id = ct.org_id
from public.contacts ct
where s.contact_id = ct.id and s.org_id is null;

-- ── Refuse to half-apply ────────────────────────────────────────────────────
-- A row we cannot place is exactly the condition this migration exists to
-- remove, so it fails loudly rather than leaving a nullable column behind.

do $$
declare
  bad_findings bigint;
  bad_snapshots bigint;
begin
  select count(*) into bad_findings from public.guardrail_findings where org_id is null or workspace_id is null;
  select count(*) into bad_snapshots from public.partner_health_snapshots where org_id is null;

  if bad_findings > 0 then
    raise exception
      'BSR-653: % guardrail_findings row(s) could not be placed in an org/workspace — every parent FK is null. Assign or delete them before re-running.',
      bad_findings;
  end if;
  if bad_snapshots > 0 then
    raise exception
      'BSR-653: % partner_health_snapshots row(s) have neither a company nor a contact to resolve an org from.',
      bad_snapshots;
  end if;
end $$;

alter table public.guardrail_findings
  alter column org_id set not null,
  alter column workspace_id set not null;

alter table public.partner_health_snapshots
  alter column org_id set not null;

create index if not exists guardrail_findings_workspace_idx
  on public.guardrail_findings (org_id, workspace_id);

create index if not exists partner_health_snapshots_org_idx
  on public.partner_health_snapshots (org_id, company_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Both already had RLS enabled with no policies (deny-all, service-role only).
-- Now that they carry a real scope they get member reads, matching the tables
-- around them. Writes stay service-role: both are produced by the system, not by
-- a signed-in user typing into a form.

drop policy if exists guardrail_findings_workspace_member_select on public.guardrail_findings;
create policy guardrail_findings_workspace_member_select on public.guardrail_findings
  as permissive for select to authenticated
  using ((select app_private.is_workspace_member(workspace_id)));

drop policy if exists partner_health_snapshots_org_member_select on public.partner_health_snapshots;
create policy partner_health_snapshots_org_member_select on public.partner_health_snapshots
  as permissive for select to authenticated
  using ((select app_private.is_org_member(org_id)));

grant select on public.guardrail_findings to authenticated;
grant select on public.partner_health_snapshots to authenticated;
