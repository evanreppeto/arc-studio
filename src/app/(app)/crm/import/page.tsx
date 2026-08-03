import Link from "next/link";

import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { CSV_IMPORT_CONNECTOR_KEY } from "@/lib/connectors/import";
import { listWorkspaceConnectors } from "@/lib/connectors/read-model";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

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
export default async function CrmImportPage() {
  const ctx = await getCurrentWorkspaceContext().catch(() => null);

  // The connector must be enabled with a default persona before an import can run:
  // leads carry a NOT NULL persona. Resolved here so the wizard can say so up
  // front rather than failing at the last step.
  let ready = false;
  if (ctx?.workspaceId && isSupabaseAdminConfigured()) {
    const connectors = await listWorkspaceConnectors(getSupabaseAdminClient(), ctx.workspaceId).catch(() => []);
    ready = connectors.some((c) => c.key === CSV_IMPORT_CONNECTOR_KEY && c.status === "connected");
  }

  return (
    <div className="crm-import">
      <header className="imp-head">
        <h1>Import your records</h1>
        <p>
          Bring contacts in from a spreadsheet or a CRM export. You&apos;ll see exactly what will change before
          anything is written, and importing the same file again updates your records rather than duplicating
          them — so you can do this whenever you need to, not just once.
        </p>
      </header>

      <ImportWizard ready={ready} />

      <p className="imp-note">
        Looking for a live connection instead? HubSpot and Mailchimp can sync from{" "}
        <Link href="/settings?s=connections">Settings → Connections</Link>.
      </p>
    </div>
  );
}
