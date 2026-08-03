import { describe, expect, it } from "vitest";

import { type HubspotContact, type HubspotImportOptions, OFFICIAL_PERSONA_MAPPINGS } from "@/domain";

import { fixtureEnrichmentProvider } from "../enrichment/provider";
import { importContactsFromSource, type ImportPersistDeps } from "./import-run";
import { fixtureCrmImportSource, fixtureCrmImportSourceFromContacts } from "./source";

const PERSONA = OFFICIAL_PERSONA_MAPPINGS[0];
const options: HubspotImportOptions = { defaultPersona: PERSONA, source: "hubspot" };

type PersistCall = { externalLeadId?: string; wasExisting: boolean; partnerTier?: string; metadata?: unknown };

/**
 * In-memory persistence harness: `persist` "inserts" a lead keyed by its external
 * id (registering it so a re-import finds it), and updates in place when handed an
 * existing ref — mirroring persistLeadIngestion's real create-vs-update behaviour
 * so idempotency can be proven without a live client.
 */
function harness(opts: { throwFor?: Set<string> } = {}) {
  const store = new Map<string, { leadId: string; companyId: string | null; contactId: string | null; propertyId: string | null }>();
  const calls: PersistCall[] = [];
  let n = 0;

  const findExisting: NonNullable<ImportPersistDeps["findExisting"]> = async (_client, _orgId, externalLeadId) => {
    const id = externalLeadId?.trim();
    return id && store.has(id) ? store.get(id)! : null;
  };

  const persist: NonNullable<ImportPersistDeps["persist"]> = async (args) => {
    const externalId = args.input.externalLeadId ?? undefined;
    if (externalId && opts.throwFor?.has(externalId)) throw new Error("persist boom");
    const wasExisting = Boolean(args.existing?.leadId);
    let refs;
    if (args.existing?.leadId) {
      refs = {
        leadId: args.existing.leadId,
        companyId: args.existing.companyId ?? null,
        contactId: args.existing.contactId ?? null,
        propertyId: args.existing.propertyId ?? null,
      };
    } else {
      n += 1;
      refs = { leadId: `lead-${n}`, companyId: args.input.company ? `co-${n}` : null, contactId: args.input.contact ? `ct-${n}` : null, propertyId: null };
      if (externalId) store.set(externalId, refs);
    }
    calls.push({ externalLeadId: externalId, wasExisting, partnerTier: args.input.company?.partnerTier, metadata: args.input.metadata });
    return { ...refs, leadCreated: !wasExisting };
  };

  return { store, calls, deps: { findExisting, persist } as ImportPersistDeps };
}

function contact(id: string, properties: Record<string, unknown>): HubspotContact {
  return { id, properties };
}

const client = {} as never;

describe("importContactsFromSource", () => {
  it("imports usable contacts and skips unusable/id-less ones (best-effort)", async () => {
    const { calls, deps } = harness();
    const source = fixtureCrmImportSource([
      {
        contacts: [
          contact("1", { firstname: "Dana", email: "d@acme.co", company: "Acme" }),
          contact("2", { company: "no contact fields" }), // unusable → skipped
          { id: "", properties: { email: "x@y.co" } }, // id-less → skipped
        ],
      },
    ]);
    const res = await importContactsFromSource({ client, orgId: "org-1", source, options, deps });
    expect(res).toMatchObject({ imported: 1, updated: 0, skipped: 2, failed: 0, pages: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].externalLeadId).toBe("1");
  });

  it("is idempotent on the external id — a re-import updates instead of duplicating", async () => {
    const h = harness();
    const contacts = [contact("1", { email: "a@b.co" }), contact("2", { email: "c@d.co" })];
    const first = await importContactsFromSource({ client, orgId: "org-1", source: fixtureCrmImportSourceFromContacts(contacts), options, deps: h.deps });
    expect(first).toMatchObject({ imported: 2, updated: 0 });

    const second = await importContactsFromSource({ client, orgId: "org-1", source: fixtureCrmImportSourceFromContacts(contacts), options, deps: h.deps });
    expect(second).toMatchObject({ imported: 0, updated: 2 });
    expect(h.store.size).toBe(2); // still two leads, not four
    expect(h.calls.filter((c) => c.wasExisting)).toHaveLength(2);
  });

  it("keeps going when one record throws during persistence", async () => {
    const { deps } = harness({ throwFor: new Set(["2"]) });
    const source = fixtureCrmImportSourceFromContacts([
      contact("1", { email: "a@b.co" }),
      contact("2", { email: "c@d.co" }),
      contact("3", { email: "e@f.co" }),
    ]);
    const res = await importContactsFromSource({ client, orgId: "org-1", source, options, deps });
    expect(res).toMatchObject({ imported: 2, failed: 1 });
    expect(res.errors.find((e) => e.externalId === "2")?.message).toContain("boom");
  });

  it("applies firmographic enrichment before persistence (tier stamped on the company)", async () => {
    const { calls, deps } = harness();
    const enrichment = fixtureEnrichmentProvider({ "acme.co": { employeeCount: 400, industry: "Restoration" } });
    const source = fixtureCrmImportSourceFromContacts([
      contact("1", { email: "d@acme.co", company: "Acme" }),
      contact("2", { email: "n@nomatch.co", company: "NoMatch" }),
    ]);
    const res = await importContactsFromSource({ client, orgId: "org-1", source, options, enrichment, deps });
    expect(res.enriched).toBe(1);
    const acme = calls.find((c) => c.externalLeadId === "1");
    expect(acme?.partnerTier).toBe("A");
    expect(acme?.metadata).toMatchObject({ enrichment: { employee_count: 400, industry: "Restoration" } });
    // The un-matched contact is still imported, just without firmographics.
    expect(calls.find((c) => c.externalLeadId === "2")?.partnerTier).toBeUndefined();
  });

  it("paginates through the source and caps runaway pagination", async () => {
    const { deps } = harness();
    const source = fixtureCrmImportSource([
      { contacts: [contact("1", { email: "a@b.co" })] },
      { contacts: [contact("2", { email: "c@d.co" })] },
      { contacts: [contact("3", { email: "e@f.co" })] },
    ]);
    const res = await importContactsFromSource({ client, orgId: "org-1", source, options, deps });
    expect(res).toMatchObject({ imported: 3, pages: 3 });

    const capped = await importContactsFromSource({
      client,
      orgId: "org-1",
      source: fixtureCrmImportSource([
        { contacts: [contact("1", { email: "a@b.co" })] },
        { contacts: [contact("2", { email: "c@d.co" })] },
      ]),
      options,
      deps: harness().deps,
      maxPages: 1,
    });
    expect(capped.pages).toBe(1);
    expect(capped.imported).toBe(1);
  });
});

// BSR-640. The engine can now report what it did to each row, so a run leaves a
// record instead of a line of status text that scrolls away.
describe("per-record provenance", () => {
  it("reports created for a new lead and updated for a re-import of the same external id", async () => {
    const h = harness();
    const recorded: Array<{ externalId: string; leadId: string; action: string }> = [];
    const recordProvenance = async (r: { externalId: string; leadId: string; action: "created" | "updated" }) => {
      recorded.push({ externalId: r.externalId, leadId: r.leadId, action: r.action });
    };
    const contacts = [contact("c1", { firstname: "Ada", email: "ada@example.com" })];

    await importContactsFromSource({
      client, orgId: "org-1", source: fixtureCrmImportSourceFromContacts(contacts), options, deps: h.deps, recordProvenance,
    });
    await importContactsFromSource({
      client, orgId: "org-1", source: fixtureCrmImportSourceFromContacts(contacts), options, deps: h.deps, recordProvenance,
    });

    // Same lead id both times — the re-import updated rather than duplicating, and
    // the record says so. An undo that could not tell these apart would delete a
    // row the first run created and the second merely touched.
    expect(recorded).toEqual([
      { externalId: "c1", leadId: "lead-1", action: "created" },
      { externalId: "c1", leadId: "lead-1", action: "updated" },
    ]);
  });

  it("does not count a record as failed when only its provenance write blew up", async () => {
    // Provenance is bookkeeping AROUND the import. If a recorder failure fell
    // through to the per-record catch, a row that actually landed would be
    // reported to the operator as failed — worse than having no record at all.
    const h = harness();
    const recordProvenance = async () => {
      throw new Error("provenance table offline");
    };

    const result = await importContactsFromSource({
      client,
      orgId: "org-1",
      source: fixtureCrmImportSourceFromContacts([contact("c1", { firstname: "Ada", email: "ada@example.com" })]),
      options,
      deps: h.deps,
      recordProvenance,
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("imports exactly as before when no recorder is supplied", async () => {
    const h = harness();
    const result = await importContactsFromSource({
      client,
      orgId: "org-1",
      source: fixtureCrmImportSourceFromContacts([contact("c1", { firstname: "Ada", email: "ada@example.com" })]),
      options,
      deps: h.deps,
    });
    expect(result.imported).toBe(1);
  });
});

// BSR-641. The only way to find out what an import would do used to be to run it.
describe("dry run", () => {
  it("produces the same create/update/skip counts without writing anything", async () => {
    const h = harness();
    const contacts = [
      contact("c1", { firstname: "Ada", email: "ada@example.com" }),
      contact("c2", { firstname: "Grace", email: "grace@example.com" }),
      contact("c3", {}), // no usable name/email/phone
    ];

    // Commit one contact first, so the dry run has both a create and an update to
    // classify rather than only the easy case.
    await importContactsFromSource({
      client, orgId: "org-1", source: fixtureCrmImportSourceFromContacts([contacts[0]]), options, deps: h.deps,
    });
    const persistCallsBefore = h.calls.length;

    const preview = await importContactsFromSource({
      client, orgId: "org-1", source: fixtureCrmImportSourceFromContacts(contacts), options, deps: h.deps, dryRun: true,
    });

    expect(preview.imported).toBe(1); // c2 is new
    expect(preview.updated).toBe(1);  // c1 already exists
    expect(preview.skipped).toBe(1);  // c3 is unusable
    // The assertion that matters: the persist seam was never called again.
    expect(h.calls.length).toBe(persistCallsBefore);
  });

  it("carries resolved sample rows so a mis-mapped column is visible before committing", async () => {
    const h = harness();
    const preview = await importContactsFromSource({
      client,
      orgId: "org-1",
      source: fixtureCrmImportSourceFromContacts([
        contact("c1", { firstname: "Ada", lastname: "Lovelace", email: "ada@example.com", company: "Analytical Ltd" }),
      ]),
      options,
      deps: h.deps,
      dryRun: true,
    });

    expect(preview.sample).toEqual([
      expect.objectContaining({
        externalId: "c1",
        action: "create",
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Analytical Ltd",
        reason: null,
      }),
    ]);
  });

  it("explains a skipped row rather than only counting it", async () => {
    const h = harness();
    const preview = await importContactsFromSource({
      client, orgId: "org-1", source: fixtureCrmImportSourceFromContacts([contact("c9", {})]), options, deps: h.deps, dryRun: true,
    });
    expect(preview.sample?.[0]).toMatchObject({ externalId: "c9", action: "skip", reason: "no usable name/email/phone" });
  });

  it("spends nothing on enrichment — it reports what WOULD be enriched", async () => {
    // meterConnectorCall authorizes each lookup against the workspace spend cap and
    // records usage after. A preview that silently spends money is a worse bug than
    // no preview at all.
    const h = harness();
    let lookups = 0;
    const enrichment = { enrich: async () => { lookups += 1; return { industry: "Restoration" }; } };

    const preview = await importContactsFromSource({
      client,
      orgId: "org-1",
      source: fixtureCrmImportSourceFromContacts([contact("c1", { firstname: "Ada", email: "ada@example.com" })]),
      options,
      deps: h.deps,
      enrichment,
      dryRun: true,
    });

    expect(preview.enriched).toBe(1);
    expect(lookups).toBe(0);
  });

  it("caps the sample so a preview never becomes a second copy of the file", async () => {
    const h = harness();
    const many = Array.from({ length: 60 }, (_, i) => contact(`c${i}`, { firstname: `P${i}`, email: `p${i}@example.com` }));
    const preview = await importContactsFromSource({
      client, orgId: "org-1", source: fixtureCrmImportSourceFromContacts(many), options, deps: h.deps, dryRun: true,
    });
    expect(preview.imported).toBe(60);
    expect(preview.sample).toHaveLength(25);
  });

  it("leaves the sample undefined on a real import", async () => {
    const h = harness();
    const result = await importContactsFromSource({
      client,
      orgId: "org-1",
      source: fixtureCrmImportSourceFromContacts([contact("c1", { firstname: "Ada", email: "ada@example.com" })]),
      options,
      deps: h.deps,
    });
    expect(result.sample).toBeUndefined();
  });
});
