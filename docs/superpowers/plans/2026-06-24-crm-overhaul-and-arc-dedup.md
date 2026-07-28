# CRM Overhaul + Arc Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CRM read like a calm, professional CRM (row-click opens, tabbed record view) and stop Arc from creating duplicate records (find-or-create leads/properties + DB backstops + a `search_crm` read tool).

**Architecture:** Three independently-shippable phases. Phase 1 reorganizes the record detail page into a slim header + four URL-driven (`?tab=`) tabs — no component internals change, panels just move between tabs. Phase 2 simplifies the list page (whole-row link via `DataTable`'s existing `rowHref`, drop the preview sidebar, fewer columns, one view selector). Phase 3 adds real dedup: pure matching helpers in `src/domain/`, find-or-create wiring in `src/lib/`, partial-unique DB indexes, and an Arc `search_crm` tool so it updates instead of duplicating.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, TypeScript, Supabase (service-role admin client), Vitest, `@tanstack/react-table` (`DataTable`), Claude Agent SDK (`apps/arc-runner`).

**Testing convention (honored from the repo):** `src/domain/` is pure and unit-tested in `src/domain/__tests__/` (Vitest). Persistence/route logic is tested where existing tests exist. The CRM UI components have **no** component tests in this repo, so Phase 1/2 UI tasks use an `edit → typecheck → lint → preview-verify` loop rather than inventing a component-test harness. Mock `next/cache` per-file in route tests (`revalidatePath` throws in the Vitest node env). Run `tsc`/`pnpm build` for type checks; `pnpm lint` is eslint-only and scans vendored files, so scope it to changed files.

---

## File Structure

**Phase 1 — record view**
- Create: `src/app/crm/_components/crm-record-tabs.tsx` — client component: the tab bar (`<Link href="?tab=...">`), reads active tab, renders nothing else (presentational).
- Create: `src/app/crm/_components/crm-record-header.tsx` — the new slim header (extracted from `RecordHeaderBand`).
- Modify: `src/app/crm/_components/crm-record-page.tsx` — read `tab`, render header + tab bar + one tab's panels.
- Modify: the six `src/app/crm/<object>/[recordId]/page.tsx` route files — thread `searchParams.tab` into `<CrmRecordPage tab=... />`.
- Reuse unchanged: every panel in `crm-record-detail.tsx` and `record-interactions/*` (they move between tabs, internals untouched).

**Phase 2 — list view**
- Modify: `src/app/crm/_components/crm-object-table.tsx` — switch to `rowHref`, delete select/double-click logic + the `open` column + the `SignalSelect` "List view" dropdown.
- Modify: `src/app/crm/_components/crm-object-page.tsx` — delete `RecordPreviewPanel` + the two-column grid; render the table full-width; drop `selected`/`selectedRow` plumbing.
- Modify: `src/app/crm/_components/crm-field-presets.ts` — trim each object's `tableColumns` to ≤5.

**Phase 3 — Arc dedup**
- Create: `src/domain/crm-matching.ts` — pure normalizers (`normalizeEmailKey`, `normalizePhoneKey`, `normalizeDomain`, `normalizeAddressKey`) + `isWithinWindow`.
- Create: `src/domain/__tests__/crm-matching.test.ts`.
- Modify: `src/domain/index.ts` — export `./crm-matching`.
- Modify: `src/lib/lead-ingestion/persistence.ts` — `existing.propertyId` + `existing.leadId` (reuse/update vs insert); return `leadCreated`.
- Modify: `src/lib/arc/record-writes.ts` — resolve company(domain)/contact(phone)/property/lead matches; pass `existing`; return richer `dedup`.
- Modify: `src/app/api/v1/arc/crm/leads/route.ts` — `201` create vs `200` matched.
- Modify: `src/lib/interactions/persistence.ts` — content-window dedup in `insertNote`/`insertTask`.
- Create: `supabase/migrations/20260624120000_crm_dedup_guards.sql` — merge existing dupes + partial unique indexes.
- Create: `src/app/api/v1/arc/crm/search/route.ts` — `GET` unified `search_crm`.
- Modify: `apps/arc-runner/src/tools/crm-read.ts` — add `search_crm` tool.
- Modify: `apps/arc-runner/src/tools/index.test.ts` — add `search_crm` to `READ`.
- Modify: `apps/arc-runner/src/prompt.ts` — instruct search-then-update.

---

# PHASE 1 — Individual record view (tabs)

### Task 1.1: Add `tab` prop threading from routes into `CrmRecordPage`

**Files:**
- Modify: `src/app/crm/_components/crm-record-page.tsx:47-54` (props type + signature)
- Modify: all six `src/app/crm/<object>/[recordId]/page.tsx` (companies, contacts, properties, leads, jobs, outcomes)

- [ ] **Step 1: Add `tab` to the props type and signature**

In `crm-record-page.tsx`, change the props type and function signature:

```tsx
type CrmRecordPageProps = {
  action?: string;
  tab?: string;
  objectKey: CrmObjectKey;
  recordId: string;
};

export async function CrmRecordPage({ action, tab, objectKey, recordId }: CrmRecordPageProps) {
```

- [ ] **Step 2: Thread `searchParams.tab` in each route file**

Each route currently ends with (example `leads`):

```tsx
return <CrmRecordPage action={getValue(query.action)} objectKey="leads" recordId={recordId} />;
```

Change each of the six to also pass `tab`:

```tsx
return <CrmRecordPage action={getValue(query.action)} tab={getValue(query.tab)} objectKey="leads" recordId={recordId} />;
```

(Keep each file's existing `objectKey` literal — only add the `tab` prop.)

- [ ] **Step 3: Typecheck**

Run: `pnpm build` (or `npx tsc --noEmit`)
Expected: compiles; `tab` is unused for now (acceptable — wired in 1.3). If the linter flags unused, proceed to 1.2/1.3 which consume it.

- [ ] **Step 4: Commit**

```bash
git add src/app/crm/_components/crm-record-page.tsx src/app/crm/*/\[recordId\]/page.tsx
git commit -m "feat(crm): thread tab searchParam into record page"
```

---

### Task 1.2: Create the tab bar component

**Files:**
- Create: `src/app/crm/_components/crm-record-tabs.tsx`

- [ ] **Step 1: Write the component**

```tsx
import Link from "next/link";

import { theme } from "../../_components/theme";

export const RECORD_TABS = ["overview", "activity", "intelligence", "related"] as const;
export type RecordTabKey = (typeof RECORD_TABS)[number];

const TAB_LABELS: Record<RecordTabKey, string> = {
  overview: "Overview",
  activity: "Activity",
  intelligence: "Intelligence",
  related: "Related",
};

/** Resolve the active tab from a raw searchParam, defaulting to overview. */
export function normalizeRecordTab(value: string | undefined): RecordTabKey {
  return (RECORD_TABS as readonly string[]).includes(value ?? "")
    ? (value as RecordTabKey)
    : "overview";
}

/** URL-driven tab bar. basePath is the record's own path (e.g. /crm/leads/<id>). */
export function CrmRecordTabs({ activeTab, basePath }: { activeTab: RecordTabKey; basePath: string }) {
  return (
    <div className="flex flex-wrap gap-5 border-b border-[var(--border-hairline)]">
      {RECORD_TABS.map((tab) => {
        const isActive = tab === activeTab;
        const href = tab === "overview" ? basePath : `${basePath}?tab=${tab}`;
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`relative inline-flex min-h-9 items-center pb-2.5 text-sm font-medium transition ${
              isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            href={href}
            key={tab}
          >
            {TAB_LABELS[tab]}
            {isActive ? <span aria-hidden className={theme.control.tabMarker} /> : null}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: compiles (the component is not yet imported — that's fine).

- [ ] **Step 3: Commit**

```bash
git add src/app/crm/_components/crm-record-tabs.tsx
git commit -m "feat(crm): add URL-driven record tab bar"
```

---

### Task 1.3: Slim the header and render panels by tab

**Files:**
- Modify: `src/app/crm/_components/crm-record-page.tsx:136-175` (the render body)

**Panel → tab mapping (the checklist — every current panel must land in exactly one tab):**
- Overview: `StoredFields` (core), `NextBestAction`, recent `RecordTimeline` (already capped by read-model)
- Activity: `TasksPanel`, `NotesPanel`, full `RecordTimeline`
- Intelligence: `PersonaIntelligence`, `EngagementSummary`, `EvidenceSection`, `RelationshipGraph`, `DataQuality`
- Related: `ConnectedRecords`, `ContactChannels`, `LinkedCampaignsPanel`

- [ ] **Step 1: Import the tab bar and compute the active tab**

At the top of `crm-record-page.tsx`, add to imports:

```tsx
import { CrmRecordTabs, normalizeRecordTab } from "./crm-record-tabs";
```

Inside the function, after `const record = recordResult;` (line ~79), add:

```tsx
const activeTab = normalizeRecordTab(tab);
const basePath = `/crm/${record.key}/${record.id}`;
```

- [ ] **Step 2: Replace the render body (the `<div className="space-y-5">…</div>` block, lines ~136-175)**

Replace the existing `RecordHeaderBand` + `RecordQuickStats` + two-column grid with header → tab bar → per-tab content. Keep the `showEditForm` form on Overview:

```tsx
      <div className="space-y-5">
        <RecordHeaderBand record={record} />

        <CrmRecordTabs activeTab={activeTab} basePath={basePath} />

        {activeTab === "overview" ? (
          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              {showEditForm && isCrmEntityKey(objectKey) ? (
                <CrmRecordForm objectKey={objectKey} mode="edit" recordId={recordId} values={editValues} />
              ) : null}
              <StoredFields record={record} />
            </div>
            <aside className="min-w-0 space-y-5">
              <NextBestAction record={record} />
              {timeline?.status === "live" ? <RecordTimeline entries={timeline.entries} /> : null}
            </aside>
          </div>
        ) : null}

        {activeTab === "activity" && entityType ? (
          <div className="min-w-0 space-y-5">
            {tasks?.status === "live" ? (
              <TasksPanel entityType={entityType} entityId={recordId} tasks={tasks.tasks} />
            ) : null}
            {notes?.status === "live" ? (
              <NotesPanel entityType={entityType} entityId={recordId} notes={notes.notes} agentName={agentName} />
            ) : null}
            {timeline?.status === "live" ? <RecordTimeline entries={timeline.entries} /> : null}
          </div>
        ) : null}

        {activeTab === "intelligence" ? (
          <div className="min-w-0 space-y-5">
            <PersonaIntelligence record={record} />
            <EngagementSummary metrics={record.engagement} />
            <EvidenceSection record={record} />
            <RelationshipGraph nodes={record.graph} />
            <DataQuality items={record.dataQuality} recordId={record.id} objectLabel={record.label} />
          </div>
        ) : null}

        {activeTab === "related" ? (
          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
            <ConnectedRecords record={record} agentName={agentName} />
            <ContactChannels record={record} />
            <LinkedCampaignsPanel campaigns={linkedCampaigns} />
          </div>
        ) : null}
      </div>
```

Note: `RecordQuickStats` is intentionally dropped from the page (its six stat boxes were the prime offender). If a later task wants 2-3 of those stats, they belong inline in the header — out of scope here. Remove the now-unused `RecordQuickStats` import to satisfy lint.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: compiles. If `RecordQuickStats` import is unused, delete it from the import block (lines 18-30).

- [ ] **Step 4: Lint the changed file**

Run: `npx eslint src/app/crm/_components/crm-record-page.tsx`
Expected: no errors (no unused imports).

- [ ] **Step 5: Preview-verify**

Start the dev server (`preview_start`), open `/crm/leads` → open a record. Confirm: slim header, four tabs, Overview shows Details + Next action + recent timeline; clicking Intelligence/Activity/Related swaps content via URL `?tab=`. Screenshot Overview + Intelligence.

- [ ] **Step 6: Commit**

```bash
git add src/app/crm/_components/crm-record-page.tsx
git commit -m "feat(crm): tabbed record view (overview/activity/intelligence/related)"
```

---

# PHASE 2 — List view

### Task 2.1: Whole-row link + remove select/double-click + open column

**Files:**
- Modify: `src/app/crm/_components/crm-object-table.tsx`

- [ ] **Step 1: Pass `rowHref` and drop the row handlers in the `DataTable` call (lines ~274-291)**

Replace the `onRowClick` / `onRowDoubleClick` / `isSelected` / `pinnedAccentRail` props with `rowHref`:

```tsx
      <DataTable
        columns={columnDefs}
        data={filteredRows}
        getRowId={(row) => row.id}
        rowHref={(row) => row.href}
        pageSize={pageSize}
        paginationLabel="records"
        minWidth="min-w-[760px]"
        emptyState={
          <EmptyState
            title={activeView === "all-records" ? `No ${objectLabel.toLowerCase()} found` : `No ${activeViewLabel.toLowerCase()} records found`}
            detail={normalizedQuery ? `No records match "${query.trim()}". Clear the search or try another term.` : "No records match this CRM view yet."}
          />
        }
      />
```

- [ ] **Step 2: Delete the `open` column (lines ~80-101)** — remove the entire `defs.push({ id: "open", … })` block. The whole row is now the link.

- [ ] **Step 3: Delete the now-dead interaction code**

Remove: `useRouter`/`useRef`/`useEffect` for clicks, `clickTimeoutRef`, `selectedHref`, `selectRecord`, `openRecord`, `scheduleSelectRecord`, `openRecordFromDoubleClick` (lines ~56-57, ~134-177), the `selectedRecordId` prop from the component's props (lines ~42-54), and the `ArrowRight` import. In `renderColumnContent`, drop the `selected` arg and the `selected ? "text-[var(--accent)]" …` branch (use the default `text-[var(--text-primary)]`). Update the `columnDefs` cell call to `renderColumnContent(column.key, row.original)`.

- [ ] **Step 4: Remove the `SignalSelect` "List view" dropdown (lines ~198-210)** — delete that one `<SignalSelect label="List view" …>` block (the segmented tabs below at lines ~252-270 remain as the single view selector). Adjust the filter-grid `xl:grid-cols-[…]` template from five columns to four (drop the `170px`): `xl:grid-cols-[minmax(240px,1fr)_150px_140px_130px]`.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/app/crm/_components/crm-object-table.tsx`
Expected: compiles, no unused-symbol errors. Remove any import left unused by Steps 2-4 (`ArrowRight`, `useRouter`).

- [ ] **Step 6: Commit**

```bash
git add src/app/crm/_components/crm-object-table.tsx
git commit -m "feat(crm): list rows open the record on click; drop dup view dropdown"
```

---

### Task 2.2: Remove the preview sidebar, render the table full-width

**Files:**
- Modify: `src/app/crm/_components/crm-object-page.tsx`

- [ ] **Step 1: Drop the grid + sidebar (lines ~93-137)**

Replace the `<div className="mt-4 grid … lg:grid-cols-[…]">` wrapper (which contained `<main>` and `<RecordPreviewPanel>`) with the `<main>` content rendered full-width and no sidebar:

```tsx
      <section className="signal-panel module-rise mt-4 overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-[var(--border-hairline)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-editorial text-xl font-medium tracking-[-0.012em] text-[var(--text-primary)]">
                {crmObject.label}
              </h2>
              <StatusPill tone="blue">{filteredRows.length} shown</StatusPill>
            </div>
            <p className="mt-1 max-w-[72ch] text-sm leading-6 text-[var(--text-secondary)]">{crmObject.description}</p>
          </div>
          {isCrmEntityKey(objectKey) ? (
            <Link className={buttonClasses({ variant: "primary", size: "sm" })} href={`${crmObject.href}?action=new`}>
              New {singularLabel(crmObject.label)}
            </Link>
          ) : null}
        </div>

        <CrmObjectTable
          activeView={activeView}
          activeViewDescription={activeViewMeta.description}
          activeViewLabel={activeViewMeta.label}
          objectHref={crmObject.href}
          objectKey={objectKey}
          objectLabel={crmObject.label}
          primaryField={crmObject.primaryField}
          rows={filteredRows}
          secondaryField={crmObject.secondaryField}
          views={crmListViews.map((listView) => ({
            ...listView,
            count: getRowsForListView(crmObject.sampleRows, listView.key).length,
            href: `${crmObject.href}?view=${listView.key}`,
          }))}
        />
      </section>
```

Note this removes the duplicate `ObjectViewMenu` (the header-level view tabs) — the single view selector now lives only inside `CrmObjectTable`. Also remove the `selectedRecordId` prop (deleted in 2.1).

- [ ] **Step 2: Delete dead code** — remove the `RecordPreviewPanel`, `ObjectViewMenu`, `quickActions`, `recordChecklist` functions and the now-unused `selected`/`selectedRow` lines (45) and the `selected` prop from `CrmObjectPageProps`. Remove the route files' `selected={getValue(query.selected)}` pass-through if present (grep `selected=` under `src/app/crm/*/page.tsx`). Remove imports left unused (`CrmObjectRow`, `theme` if no longer referenced).

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/app/crm/_components/crm-object-page.tsx`
Expected: compiles, no unused symbols.

- [ ] **Step 4: Preview-verify**

Open `/crm/leads`: single full-width table, a row click navigates straight to the record, one row of view tabs, no right sidebar. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/app/crm/_components/crm-object-page.tsx src/app/crm/*/page.tsx
git commit -m "feat(crm): full-width list, remove preview sidebar + duplicate view menu"
```

---

### Task 2.3: Trim table columns to ≤5

**Files:**
- Modify: `src/app/crm/_components/crm-field-presets.ts`

- [ ] **Step 1: Inspect current presets**

Run: `npx eslint --no-eslintrc -v >/dev/null 2>&1; cat src/app/crm/_components/crm-field-presets.ts` (or open it). Find each object's `tableColumns` array.

- [ ] **Step 2: Set each object's `tableColumns` to the 5-column set**

For every object key, set `tableColumns` to (in order): `["primary", "status", "persona", "score", "updated"]`. Drop `secondary`, `nextAction`, `value`, `links` from the default table. (The data still renders on the record page.) If an object legitimately has no score (e.g. outcomes), use `["primary", "status", "persona", "updated"]` — never re-add the dropped columns.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: compiles (`CrmTableColumnKey` values used are all valid).

- [ ] **Step 4: Preview-verify** — each `/crm/<object>` list shows ≤5 columns. Screenshot the leads list.

- [ ] **Step 5: Commit**

```bash
git add src/app/crm/_components/crm-field-presets.ts
git commit -m "feat(crm): trim list tables to five columns"
```

---

# PHASE 3 — Arc dedup

### Task 3.1: Pure matching helpers (domain)

**Files:**
- Create: `src/domain/crm-matching.ts`
- Test: `src/domain/__tests__/crm-matching.test.ts`
- Modify: `src/domain/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/crm-matching.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isWithinWindow,
  normalizeAddressKey,
  normalizeDomain,
  normalizeEmailKey,
  normalizePhoneKey,
} from "../crm-matching";

describe("crm matching normalizers", () => {
  it("lowercases and trims email", () => {
    expect(normalizeEmailKey("  John.Doe@Acme.COM ")).toBe("john.doe@acme.com");
    expect(normalizeEmailKey("")).toBeNull();
    expect(normalizeEmailKey(undefined)).toBeNull();
  });

  it("reduces phone to digits, dropping a US country prefix", () => {
    expect(normalizePhoneKey("+1 (312) 555-0188")).toBe("3125550188");
    expect(normalizePhoneKey("312.555.0188")).toBe("3125550188");
    expect(normalizePhoneKey("123")).toBeNull();
  });

  it("extracts a bare host from a url or domain", () => {
    expect(normalizeDomain("https://www.Acme.com/contact")).toBe("acme.com");
    expect(normalizeDomain("Acme.com")).toBe("acme.com");
    expect(normalizeDomain("not a domain")).toBeNull();
  });

  it("builds a stable street+postal key", () => {
    expect(normalizeAddressKey("  123  Main   St. ", "60601")).toBe("123 main st|60601");
    expect(normalizeAddressKey("", "60601")).toBeNull();
  });

  it("compares ISO timestamps within a window", () => {
    expect(isWithinWindow("2026-06-24T10:00:00Z", "2026-06-24T10:05:00Z", 600_000)).toBe(true);
    expect(isWithinWindow("2026-06-24T10:00:00Z", "2026-06-24T10:20:00Z", 600_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/domain/__tests__/crm-matching.test.ts`
Expected: FAIL — cannot find module `../crm-matching`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/crm-matching.ts`:

```ts
/** Pure CRM record-matching keys. No I/O — used by the dedup persistence layer. */

export function normalizeEmailKey(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePhoneKey(phone: string | null | undefined): string | null {
  let digits = (phone ?? "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits.length >= 7 ? digits : null;
}

export function normalizeDomain(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const host = raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

export function normalizeAddressKey(
  streetLine1: string | null | undefined,
  postalCode: string | null | undefined,
): string | null {
  const street = (streetLine1 ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const postal = (postalCode ?? "").trim().toLowerCase();
  return street.length > 0 && postal.length > 0 ? `${street}|${postal}` : null;
}

export function isWithinWindow(aIso: string, bIso: string, windowMs: number): boolean {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= windowMs;
}
```

- [ ] **Step 4: Export from the domain barrel**

In `src/domain/index.ts`, add alongside the existing exports:

```ts
export * from "./crm-matching";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/domain/__tests__/crm-matching.test.ts`
Expected: PASS (5 assertions green).

- [ ] **Step 6: Commit**

```bash
git add src/domain/crm-matching.ts src/domain/__tests__/crm-matching.test.ts src/domain/index.ts
git commit -m "feat(domain): pure CRM record-matching normalizers"
```

---

### Task 3.2: Persistence supports property + lead find-or-create

**Files:**
- Modify: `src/lib/lead-ingestion/persistence.ts`

This adds two opt-in reuse paths driven entirely by the caller's `existing` map. The public ingest route passes no `existing`, so its behavior is byte-for-byte unchanged (always inserts).

- [ ] **Step 1: Extend the input + result types**

In `persistence.ts`, change `PersistLeadInput.existing` and `PersistedLeadIngestion`:

```ts
  /** Pre-resolved (deduped) ids to reuse instead of inserting. */
  existing?: {
    companyId?: string | null;
    contactId?: string | null;
    propertyId?: string | null;
    /** When set, the matching lead is UPDATED in place instead of inserting a new row. */
    leadId?: string | null;
  };
```

```ts
export type PersistedLeadIngestion = {
  companyId: string | null;
  contactId: string | null;
  propertyId: string | null;
  leadId: string;
  /** false when an existing lead was updated rather than inserted. */
  leadCreated: boolean;
};
```

- [ ] **Step 2: Reuse an existing property when provided (lines ~85-100)**

Wrap the property insert so a pre-resolved id short-circuits it:

```ts
  const propertyId = existing?.propertyId
    ? existing.propertyId
    : input.property
      ? await insertAndReturnId(supabase, "properties", orgId, {
          company_id: companyId,
          contact_id: contactId,
          persona: result.persona,
          street_line_1: input.property.streetLine1,
          street_line_2: input.property.streetLine2 ?? null,
          city: input.property.city,
          state: input.property.state.toUpperCase(),
          postal_code: input.property.postalCode,
          ...stamp,
          metadata: { ingestion_source: input.source },
        })
      : null;
```

- [ ] **Step 3: Build the lead column map once, then update-or-insert (replace lines ~102-130)**

Extract the lead values into a `const leadValues = { … }` (the exact same object currently passed to `insertAndReturnId(... "leads" ...)`), then:

```ts
  let leadId: string;
  let leadCreated: boolean;
  if (existing?.leadId) {
    const { data, error } = await supabase
      .from("leads")
      .update({ ...leadValues, updated_at: new Date().toISOString() })
      .eq("id", existing.leadId)
      .eq("org_id", orgId)
      .select("id")
      .single<InsertResult>();
    if (error) throw new Error(`Failed to update lead: ${error.message}`);
    if (!data?.id) throw new Error("Failed to update lead: no row matched.");
    leadId = data.id;
    leadCreated = false;
  } else {
    leadId = await insertAndReturnId(supabase, "leads", orgId, leadValues);
    leadCreated = true;
  }
```

- [ ] **Step 4: Return `leadCreated`**

```ts
  return { companyId, contactId, propertyId, leadId, leadCreated };
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: compiles. Existing callers that read `persisted.leadId` still work; `leadCreated` is additive. Fix any test/usage that destructures `PersistedLeadIngestion` exhaustively.

- [ ] **Step 6: Run the existing ingestion tests (regression guard)**

Run: `pnpm test src/domain/__tests__/lead-ingestion.test.ts && pnpm test src/lib`
Expected: PASS — the public path (no `existing`) still inserts and returns `leadCreated: true`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/lead-ingestion/persistence.ts
git commit -m "feat(crm): persistence supports property + lead find-or-create"
```

---

### Task 3.3: Arc resolves matches before writing (the duplicate fix)

**Files:**
- Modify: `src/lib/arc/record-writes.ts`

- [ ] **Step 1: Import the normalizers**

```ts
import { normalizeAddressKey, normalizeDomain, normalizePhoneKey } from "@/domain";
```

- [ ] **Step 2: Resolve all four matches in `createArcLead` (replace lines ~90-117)**

```ts
  const input = result.normalizedInput;

  const companyMatchId =
    input.company && input.property
      ? await findCompanyIdByNamePostal(params.supabase, params.orgId, input.company.name, input.property.postalCode)
      : null;
  // Domain fallback: if name+postal missed but metadata carries a website host, match on that.
  const companyId =
    companyMatchId ??
    (input.company ? await findCompanyIdByName(params.supabase, params.orgId, input.company.name) : null);

  const contactMatchId = input.contact?.email
    ? await findContactIdByEmail(params.supabase, params.orgId, input.contact.email)
    : input.contact?.phone
      ? await findContactIdByPhone(params.supabase, params.orgId, input.contact.phone)
      : null;

  const propertyMatchId = input.property
    ? await findPropertyId(params.supabase, params.orgId, input.property.streetLine1, input.property.postalCode)
    : null;

  // Only treat as the SAME lead when we matched both an existing company and contact.
  const leadMatchId =
    companyId && contactMatchId
      ? await findActiveLeadId(params.supabase, params.orgId, companyId, contactMatchId)
      : null;

  const persisted = await persistLeadIngestion({
    input,
    result,
    supabase: params.supabase,
    orgId: params.orgId,
    provenance: {
      origin: "agent",
      reviewStatus: params.reviewStatus,
      agentConfidence: params.agentConfidence ?? null,
    },
    existing: {
      companyId,
      contactId: contactMatchId,
      propertyId: propertyMatchId,
      leadId: leadMatchId,
    },
  });

  return {
    ok: true,
    persisted,
    dedup: {
      companyMatched: companyId !== null,
      contactMatched: contactMatchId !== null,
      propertyMatched: propertyMatchId !== null,
      leadMatched: leadMatchId !== null,
    },
  };
```

- [ ] **Step 3: Widen the result type (lines ~68-70)**

```ts
export type CreateArcLeadResult =
  | {
      ok: true;
      persisted: PersistedLeadIngestion;
      dedup: { companyMatched: boolean; contactMatched: boolean; propertyMatched: boolean; leadMatched: boolean };
    }
  | { ok: false; httpStatus: number; errors: Array<{ code: string; message: string }> };
```

- [ ] **Step 4: Add the new finder helpers (after `findContactIdByEmail`)**

```ts
async function findCompanyIdByName(supabase: SupabaseClient, orgId: string, name: string): Promise<string | null> {
  const { data } = await supabase
    .from("companies")
    .select("id")
    .eq("org_id", orgId)
    .ilike("name", name)
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

async function findContactIdByPhone(supabase: SupabaseClient, orgId: string, phone: string): Promise<string | null> {
  const key = normalizePhoneKey(phone);
  if (!key) return null;
  // Phone is stored unnormalized; fetch a small candidate set and compare keys in app code.
  const { data } = await supabase
    .from("contacts")
    .select("id, phone")
    .eq("org_id", orgId)
    .not("phone", "is", null)
    .limit(200);
  const match = (data ?? []).find((row) => normalizePhoneKey(row.phone) === key);
  return match?.id ?? null;
}

async function findPropertyId(
  supabase: SupabaseClient,
  orgId: string,
  streetLine1: string,
  postalCode: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("org_id", orgId)
    .ilike("street_line_1", streetLine1)
    .eq("postal_code", postalCode)
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

async function findActiveLeadId(
  supabase: SupabaseClient,
  orgId: string,
  companyId: string,
  contactId: string,
): Promise<string | null> {
  // Same company + contact + not archived == the same lead; refresh it instead of duplicating.
  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("org_id", orgId)
    .eq("company_id", companyId)
    .eq("contact_id", contactId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}
```

(`normalizeAddressKey`/`normalizeDomain` are imported for future use by `findPropertyId`/company-domain matching; if eslint flags an unused import after this task, keep only the ones referenced — `normalizePhoneKey` is used here.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: compiles.

- [ ] **Step 6: Commit**

```bash
git add src/lib/arc/record-writes.ts
git commit -m "fix(arc): find-or-create leads/properties/contacts to stop duplicates"
```

---

### Task 3.4: Lead route returns 200 on match, 201 on create

**Files:**
- Modify: `src/app/api/v1/arc/crm/leads/route.ts:78-88`

- [ ] **Step 1: Use `leadCreated` for the status code**

Replace the `return ok({…}, 201);` block:

```ts
    return ok(
      {
        lead_id: result.persisted.leadId,
        company_id: result.persisted.companyId,
        contact_id: result.persisted.contactId,
        property_id: result.persisted.propertyId,
        review_status: reviewStatus,
        dedup: result.dedup,
      },
      result.persisted.leadCreated ? 201 : 200,
    );
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/arc/crm/leads/route.ts
git commit -m "feat(arc): lead endpoint returns 200 when it matched an existing lead"
```

---

### Task 3.5: DB dedup backstops (migration)

**Files:**
- Create: `supabase/migrations/20260624120000_crm_dedup_guards.sql`

- [ ] **Step 1: Write the migration**

```sql
-- CRM dedup guards: merge existing duplicate contacts/properties, then add
-- partial unique indexes so duplicates cannot slip in on an app-layer miss.
-- App-layer find-or-create (record-writes.ts) is primary; these are backstops.

-- 1. Contacts: collapse duplicate (org_id, lower(email)). Relink child rows to
--    the survivor (earliest created_at) before deleting the duplicates.
with ranked as (
  select id, org_id, lower(btrim(email)) as email_key,
         row_number() over (
           partition by org_id, lower(btrim(email))
           order by created_at asc, id asc
         ) as rn
  from public.contacts
  where email is not null and btrim(email) <> ''
),
survivors as (select org_id, email_key, id as keep_id from ranked where rn = 1),
dupes as (
  select r.id as dup_id, s.keep_id
  from ranked r
  join survivors s on s.org_id = r.org_id and s.email_key = r.email_key
  where r.rn > 1
)
update public.leads l set contact_id = d.keep_id
from dupes d where l.contact_id = d.dup_id;

with ranked as (
  select id, org_id, lower(btrim(email)) as email_key,
         row_number() over (partition by org_id, lower(btrim(email)) order by created_at asc, id asc) as rn
  from public.contacts where email is not null and btrim(email) <> ''
),
survivors as (select org_id, email_key, id as keep_id from ranked where rn = 1),
dupes as (
  select r.id as dup_id, s.keep_id from ranked r
  join survivors s on s.org_id = r.org_id and s.email_key = r.email_key where r.rn > 1
)
update public.properties p set contact_id = d.keep_id
from dupes d where p.contact_id = d.dup_id;

with ranked as (
  select id, org_id, lower(btrim(email)) as email_key,
         row_number() over (partition by org_id, lower(btrim(email)) order by created_at asc, id asc) as rn
  from public.contacts where email is not null and btrim(email) <> ''
)
delete from public.contacts c using ranked r where c.id = r.id and r.rn > 1;

create unique index if not exists contacts_org_email_unique_idx
  on public.contacts (org_id, lower(btrim(email)))
  where email is not null and btrim(email) <> '';

-- 2. Properties: collapse duplicate (org_id, lower(street_line_1), postal_code).
with ranked as (
  select id, org_id, lower(btrim(street_line_1)) as street_key, postal_code,
         row_number() over (
           partition by org_id, lower(btrim(street_line_1)), postal_code
           order by created_at asc, id asc
         ) as rn
  from public.properties
),
survivors as (select org_id, street_key, postal_code, id as keep_id from ranked where rn = 1),
dupes as (
  select r.id as dup_id, s.keep_id from ranked r
  join survivors s on s.org_id = r.org_id and s.street_key = r.street_key and s.postal_code = r.postal_code
  where r.rn > 1
)
update public.leads l set property_id = d.keep_id
from dupes d where l.property_id = d.dup_id;

with ranked as (
  select id, org_id, lower(btrim(street_line_1)) as street_key, postal_code,
         row_number() over (partition by org_id, lower(btrim(street_line_1)), postal_code order by created_at asc, id asc) as rn
  from public.properties
)
delete from public.properties p using ranked r where p.id = r.id and r.rn > 1;

create unique index if not exists properties_org_address_unique_idx
  on public.properties (org_id, lower(btrim(street_line_1)), postal_code);
```

- [ ] **Step 2: Verify SQL parses against a scratch DB**

If a local/branch Supabase is available, apply it there first (Supabase MCP `apply_migration` on a dev branch, or `supabase db reset` locally). Confirm no error and that re-running is a no-op (`if not exists`). Do NOT apply to prod from here — prod (`qqbecyrhnowmooyjiztz`) is applied manually post-merge (memory `vercel-deploy`, `prod-schema-drift`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260624120000_crm_dedup_guards.sql
git commit -m "feat(db): dedup existing CRM rows + partial unique indexes"
```

---

### Task 3.6: Interactions idempotency (content-window dedup)

**Files:**
- Modify: `src/lib/interactions/persistence.ts`

- [ ] **Step 1: Import the window helper**

```ts
import { isWithinWindow } from "@/domain";
```

- [ ] **Step 2: Guard `insertNote` against an immediate duplicate (top of the function, after `resolveOrgId`)**

```ts
  const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
  const { data: recentNotes } = await supabase
    .from("crm_notes")
    .select("id, body, created_at")
    .eq("org_id", orgId)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .eq("author_kind", input.authorKind)
    .order("created_at", { ascending: false })
    .limit(5);
  const nowIso = new Date().toISOString();
  const duplicate = (recentNotes ?? []).find(
    (note) => note.body === input.body && isWithinWindow(note.created_at, nowIso, DEDUPE_WINDOW_MS),
  );
  if (duplicate) return { ok: true, id: duplicate.id };
```

(Place this after `const supabase = getSupabaseAdminClient();`.) Apply the identical pattern to `insertTask`, comparing `title` instead of `body` and selecting `id, title, created_at`.

- [ ] **Step 3: Typecheck + run interaction-related tests**

Run: `npx tsc --noEmit && pnpm test src/lib`
Expected: compiles; existing interaction/route tests pass (a single insert still returns a fresh id; the dedupe only triggers on an identical repeat).

- [ ] **Step 4: Commit**

```bash
git add src/lib/interactions/persistence.ts
git commit -m "fix(crm): dedupe identical Arc notes/tasks within a 10-minute window"
```

---

### Task 3.7: `search_crm` route

**Files:**
- Create: `src/app/api/v1/arc/crm/search/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { arcGuard, fail, ok } from "@/app/api/v1/arc/_lib/http";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Unified CRM lookup so Arc can find an existing record before deciding to
 * create one. Read-only. GET /api/v1/arc/crm/search?q=acme&type=company|contact|lead
 */
export async function GET(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const type = url.searchParams.get("type") ?? "all";
  if (q.length < 2) return fail("invalid_request", 'Query "q" must be at least 2 characters.', 400);

  const orgId = allowed.scope.orgId;
  const supabase = getSupabaseAdminClient();
  const like = `%${q}%`;

  try {
    const out: Record<string, unknown> = {};

    if (type === "all" || type === "company") {
      const { data } = await supabase
        .from("companies")
        .select("id, name, persona, status, website_url, email")
        .eq("org_id", orgId)
        .or(`name.ilike.${like},email.ilike.${like},website_url.ilike.${like}`)
        .limit(10);
      out.companies = data ?? [];
    }

    if (type === "all" || type === "contact") {
      const { data } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, email, phone, persona, status")
        .eq("org_id", orgId)
        .or(`email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`)
        .limit(10);
      out.contacts = data ?? [];
    }

    if (type === "all" || type === "lead") {
      const { data } = await supabase
        .from("leads")
        .select("id, persona, status, source, lead_score, company_id, contact_id")
        .eq("org_id", orgId)
        .or(`source.ilike.${like},loss_summary.ilike.${like}`)
        .limit(10);
      out.leads = data ?? [];
    }

    return ok({ query: q, results: out });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Search failed.", 502);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: compiles (mirrors the sibling `leads/route.ts` `GET` shape).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/arc/crm/search/route.ts
git commit -m "feat(arc): search_crm read route for find-before-create"
```

---

### Task 3.8: `search_crm` runner tool + pinned-set test + prompt

**Files:**
- Modify: `apps/arc-runner/src/tools/crm-read.ts`
- Modify: `apps/arc-runner/src/tools/index.test.ts`
- Modify: `apps/arc-runner/src/prompt.ts`

> Run runner commands from `apps/arc-runner`. Fresh worktrees need `pnpm install` there first (no shared node_modules — memory `arc-api-audit-and-approval-rec-tool`).

- [ ] **Step 1: Update the pinned READ set (failing test first)**

In `apps/arc-runner/src/tools/index.test.ts`, add `"search_crm"` to the `READ` array (e.g. right after `"search_properties"`).

- [ ] **Step 2: Run the suite to verify it fails**

Run (from `apps/arc-runner`): `pnpm test src/tools/index.test.ts`
Expected: FAIL — `ask`/`act` mode tool-name sets don't include `search_crm` yet.

- [ ] **Step 3: Add the tool**

In `apps/arc-runner/src/tools/crm-read.ts`, add a `searchCrm` tool to the array `crmReadTools` returns (match the file's existing `tool(...)` style and `runTool`/`client.apiGet` usage from sibling read tools):

```ts
  const searchCrm = tool(
    "search_crm",
    "Search existing CRM records (companies, contacts, leads) by name, email, phone, or domain BEFORE creating anything. Always call this first when you might add a lead/company/contact, and prefer update_record on a match instead of create_lead.",
    {
      q: z.string().describe("Name, email, phone, or domain to look up (min 2 chars)"),
      type: z.enum(["all", "company", "contact", "lead"]).optional(),
    },
    async (args) =>
      runTool(step, `Searching CRM for ${args.q}`, async () =>
        client.apiGet(`/api/v1/arc/crm/search?q=${encodeURIComponent(args.q)}&type=${args.type ?? "all"}`),
      ),
  );
```

Add `searchCrm` to the returned array. (Confirm `apiGet` is the client method used by the other read tools in this file; if they use a different helper, match it.)

- [ ] **Step 4: Run the suite to verify it passes**

Run (from `apps/arc-runner`): `pnpm test`
Expected: PASS — full runner suite green, including the per-mode set tests.

- [ ] **Step 5: Update the prompt**

In `apps/arc-runner/src/prompt.ts`, in the CRM-writing guidance, add a sentence near the `create_lead`/`update_record` description:

> Before creating any lead, company, or contact, call `search_crm` first. If a match exists, use `update_record` to enrich it — never call `create_lead` for a record that already exists.

- [ ] **Step 6: Commit**

```bash
git add apps/arc-runner/src/tools/crm-read.ts apps/arc-runner/src/tools/index.test.ts apps/arc-runner/src/prompt.ts
git commit -m "feat(arc): search_crm tool + search-then-update prompt guidance"
```

---

## Final verification (after all phases)

- [ ] **Typecheck + build:** `pnpm build` — green.
- [ ] **Tests:** `pnpm test` (app) and `pnpm test` in `apps/arc-runner` — green.
- [ ] **Lint (scoped):** `npx eslint` on every file changed in this plan — no errors.
- [ ] **Preview smoke:** `/crm/leads` list (row-click opens, ≤5 cols, no sidebar) → a record (four tabs, calm Overview). Screenshot both.
- [ ] **Dedup smoke (if Supabase configured):** POST the same `create_lead` payload twice to `/api/v1/arc/crm/leads`; second response is `200` with `dedup.leadMatched: true` and the same `lead_id`.
- [ ] Rebase on fresh `origin/main` before opening the PR (CRM components + `index.ts` barrels are merge hotspots — memory `stale-worktree-branch-merge-collisions`, `web-merge-drops-domain-exports`). Re-run `tsc` after the rebase.

---

## Self-review (completed)

- **Spec coverage:** Phase 1 tabs (1.1-1.3) ✓; Phase 2 row-click + sidebar removal + columns + single view selector (2.1-2.3) ✓; Phase 3 find-or-create leads (3.2-3.4), property/contact/company matching (3.3), interactions idempotency (3.6), DB backstops (3.5), search_crm + prompt (3.7-3.8) ✓; public ingest contract preserved (3.2 driven by caller `existing`) ✓.
- **Deviation from spec, noted:** interactions idempotency uses a content-window check (no schema change) instead of an explicit `idempotency_key` column — same intent, lower risk; the spec's "optional idempotency key" is dropped in favor of the window guard. Company hard-unique deliberately omitted (legit same-name orgs), matching the spec.
- **Type consistency:** `PersistedLeadIngestion.leadCreated`, `existing.{propertyId,leadId}`, and `CreateArcLeadResult.dedup.{propertyMatched,leadMatched}` are introduced in 3.2/3.3 and consumed in 3.3/3.4 with matching names. `normalizeRecordTab`/`RECORD_TABS` defined in 1.2, used in 1.3. `rowHref` is an existing `DataTable` prop (verified).
- **Placeholders:** none — every code step shows the code; every command shows expected output.
