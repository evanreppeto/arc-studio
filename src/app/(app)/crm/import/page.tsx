import Link from "next/link";

import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { CSV_IMPORT_CONNECTOR_KEY } from "@/lib/connectors/import";
import { listWorkspaceConnectors } from "@/lib/connectors/read-model";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { listImportRuns } from "@/lib/import-runs/read-model";

import { ImportHistory } from "./_components/import-history";
import { ImportWizard } from "./_components/import-wizard";
import "./import.css";

/**
 * Bringing an existing customer list in is one of the highest-stakes moments in
 * onboarding, and until BSR-642 it was a five-row textarea buried in Settings →
 * Connections: paste raw CSV, press Import, find out afterwards what happened.
 *
 * A CRM subroute rather than a new top-level nav item — importing is an occasional
 * action that belongs beside the records it writes, and the CRM board's existing
 * Import button now points here.
 */
export default async function CrmImportPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  // Which tab's Import button sent us here, so the wizard opens on that kind.
  const { as: initialKind } = await searchParams;
  const ctx = await getCurrentWorkspaceContext().catch(() => null);

  // The connector must be enabled with a default persona before an import can run:
  // leads carry a NOT NULL persona. Resolved here so the wizard can say so up
  // front rather than failing at the last step.
  let ready = false;
  let runs: Awaited<ReturnType<typeof listImportRuns>> = [];
  if (ctx?.workspaceId && ctx.orgId && isSupabaseAdminConfigured()) {
    const connectors = await listWorkspaceConnectors(getSupabaseAdminClient(), ctx.workspaceId).catch(() => []);
    ready = connectors.some((c) => c.key === CSV_IMPORT_CONNECTOR_KEY && c.status === "connected");
    runs = await listImportRuns({ orgId: ctx.orgId, workspaceId: ctx.workspaceId }).catch(() => []);
  }

  return (
    <div className="crm-import">
      <header className="imp-head">
        <h1>Import your records</h1>
        {/* Said "Bring contacts in" under an h1 reading "Import your records",
            directly above a picker offering four kinds — so the copy described
            a quarter of the screen it introduced. */}
        <p>
          Bring people, companies, jobs or notes in from a spreadsheet or a CRM export. You&apos;ll see exactly
          what will change before anything is written, and importing the same file again updates your records
          rather than duplicating them — so you can do this whenever you need to, not just once.
        </p>
      </header>

      <ImportWizard ready={ready} initialKind={initialKind} />

      <section className="imp-step">
        <div className="imp-step-h">
          <span className="imp-step-n">·</span>
          <h2>Past imports</h2>
        </div>
        <div className="imp-step-b">
          <ImportHistory runs={runs} />
        </div>
      </section>

      <p className="imp-note">
        Looking for a live connection instead? HubSpot and Mailchimp can sync from{" "}
        <Link href="/settings?s=connections">Settings → Connections</Link>.
      </p>
    </div>
  );
}
