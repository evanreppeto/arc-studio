import type { Metadata } from "next";

import { SITE_URL } from "@/lib/seo/site";

import { LegalView } from "../_components/legal-view";
import { SUBPROCESSORS } from "../_data/legal-documents";

const TITLE = "Subprocessors — Arc Studio";
const DESCRIPTION =
  "Every third party that processes data on Arc Studio's behalf, what each one does, and which are optional per workspace.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/legal/subprocessors" },
  openGraph: {
    type: "website",
    siteName: "Arc Studio",
    url: `${SITE_URL}/legal/subprocessors`,
    title: TITLE,
    description: DESCRIPTION,
  },
};

function Table({ tier, caption }: { tier: "core" | "optional"; caption: string }) {
  const rows = SUBPROCESSORS.filter((s) => s.tier === tier);
  return (
    <section className="mb-10">
      <h2 className="font-serif text-xl font-semibold text-[var(--text-primary)]">
        {tier === "core" ? "Core subprocessors" : "Optional subprocessors"}
      </h2>
      <p className="mt-2 max-w-[68ch] text-[0.925rem] leading-relaxed text-[var(--text-secondary)]">
        {caption}
      </p>
      <div className="mt-5 overflow-hidden rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)]">
        <dl>
          {rows.map((s, i) => (
            <div
              key={s.name}
              className={`px-5 py-4 ${i > 0 ? "border-t border-[color:var(--border-panel)]" : ""}`}
            >
              <dt className="text-[0.95rem] font-semibold text-[var(--text-primary)]">{s.name}</dt>
              <dd className="mt-1 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
                {s.purpose}
              </dd>
              <dd className="mt-1 text-[0.8rem] leading-relaxed text-[var(--text-muted)]">
                Data handled: {s.dataHandled}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export default function SubprocessorsPage() {
  return (
    <LegalView
      title="Subprocessors"
      currentPath="/legal/subprocessors"
      intro="Third parties that process data on our behalf. Core subprocessors apply to every workspace. Optional ones only receive data if a workspace explicitly connects them."
    >
      <Table
        tier="core"
        caption="Used by every workspace. Operating the product is not possible without these."
      />
      <Table
        tier="optional"
        caption="Only involved when a workspace enables the corresponding connector. If you never turn one on, it never receives your data."
      />
      <section className="mb-9">
        <h2 className="font-serif text-xl font-semibold text-[var(--text-primary)]">Changes</h2>
        <p className="mt-3 max-w-[68ch] text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
          This list is maintained alongside the code rather than as a separate
          document, so a new dependency or connector is added here before it
          ships. We will give notice of material additions to core subprocessors.
        </p>
      </section>
    </LegalView>
  );
}
