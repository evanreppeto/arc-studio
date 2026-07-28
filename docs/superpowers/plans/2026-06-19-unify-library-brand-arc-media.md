# Unify Library + Brand, and Give Arc Library Media Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the separate Library and Brand nav surfaces into one section (Library is home, Brand becomes a view inside it), and give the Arc runner tools to list and attach the operator's real, approval-flagged Library media to campaign drafts.

**Architecture:** Two independently shippable parts over the *same* `media_assets` store.
- **Part A (UI):** Pure Next.js / React. Remove the top-level Brand nav entry, relocate the brand-kit route under `/library/brand` with a redirect from `/brand`, and add an "Assets · Brand" segmented control. No data-layer change.
- **Part B (Arc media):** A read endpoint (`GET /api/v1/arc/media`) and an attach endpoint (`POST /api/v1/arc/library/attach`) in the marketing app, plus two runner tools (`list_media`, `attach_media`). Reuses the existing `promoteAssetToCampaign` (which already supports `libraryAssetId` provenance) and `createCampaignShell`. Every attach lands as a `pending_approval`, `dispatch_locked` campaign asset — nothing goes outbound.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts` edge gate), React 19, TypeScript, Supabase (admin client), Vitest, `@anthropic-ai/claude-agent-sdk` (runner tools), Zod, Tailwind v4 CSS variables.

**Order:** Part B is self-contained and lower-churn — do it first so the higher-churn route move (Part A) rebases on top. Each part is independently committable and shippable. Rebase on fresh `origin/main` before merging either (route folders + nav are merge-collision hotspots).

---

## Part B — Arc Library Media Access

### Task B1: Read helper — list `available_to_arc` assets

Add a pure shaper + an org-scoped query to the existing Arc handoff module. The shaper is unit-tested; the query mirrors `loadArcAttachments` already in the file.

**Files:**
- Modify: `src/lib/media-library/arc-handoff.ts`
- Test: `src/lib/media-library/arc-handoff.test.ts` (create)

- [ ] **Step 1: Write the failing test for the pure shaper**

Create `src/lib/media-library/arc-handoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toArcMediaSummary } from "./arc-handoff";

describe("toArcMediaSummary", () => {
  it("maps DB rows to compact Arc summaries with safe defaults", () => {
    const out = toArcMediaSummary([
      {
        id: "a1",
        file_name: "before-after.jpg",
        public_url: "https://x/before-after.jpg",
        storage_path: "library/org1/a1-before-after.jpg",
        kind: "image",
        width: 1200,
        height: 800,
        tags: ["fire", "before-after"],
        risk_flags: [],
      },
      {
        id: "a2",
        file_name: "logo.png",
        public_url: "https://x/logo.png",
        storage_path: "library/org1/a2-logo.png",
        kind: "logo",
        width: null,
        height: null,
        tags: null as unknown as string[],
        risk_flags: null as unknown as string[],
      },
    ]);

    expect(out).toEqual([
      {
        id: "a1",
        fileName: "before-after.jpg",
        url: "https://x/before-after.jpg",
        kind: "image",
        dimensions: "1200 × 800",
        tags: ["fire", "before-after"],
        riskFlags: [],
      },
      {
        id: "a2",
        fileName: "logo.png",
        url: "https://x/logo.png",
        kind: "logo",
        dimensions: null,
        tags: [],
        riskFlags: [],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/media-library/arc-handoff.test.ts`
Expected: FAIL — `toArcMediaSummary is not a function` (export does not exist yet).

- [ ] **Step 3: Implement the shaper + query**

Append to `src/lib/media-library/arc-handoff.ts` (keep existing exports):

```ts
/** Compact, model-facing summary of a Library asset Arc may reuse. */
export type ArcMediaSummary = {
  id: string;
  fileName: string;
  url: string;
  kind: string;
  dimensions: string | null;
  tags: string[];
  riskFlags: string[];
};

type ArcMediaRow = {
  id: string;
  file_name: string;
  public_url: string;
  storage_path: string;
  kind: string;
  width: number | null;
  height: number | null;
  tags: string[] | null;
  risk_flags: string[] | null;
};

/** Pure: media rows → compact Arc summaries. */
export function toArcMediaSummary(rows: ArcMediaRow[]): ArcMediaSummary[] {
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    url: r.public_url,
    kind: r.kind,
    dimensions: r.width && r.height ? `${r.width} × ${r.height}` : null,
    tags: r.tags ?? [],
    riskFlags: r.risk_flags ?? [],
  }));
}

/** List the org's Library assets that the operator opted into Arc (available_to_arc). */
export async function listAvailableArcMedia(
  orgId: string,
  opts: { kind?: string; limit?: number } = {},
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMediaSummary[]> {
  let query = client
    .from("media_assets" as string)
    .select("id, file_name, public_url, storage_path, kind, width, height, tags, risk_flags")
    .eq("org_id", orgId)
    .eq("available_to_arc", true)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  if (opts.kind) query = query.eq("kind", opts.kind);
  const { data, error } = await query;
  if (error) throw new Error(`list arc media failed: ${error.message}`);
  return toArcMediaSummary((data ?? []) as ArcMediaRow[]);
}

/** Resolve ONE Arc-available asset (org-scoped) for attaching. Returns null when
 *  the id is unknown, belongs to another org, or is not available_to_arc — so Arc
 *  can never attach an arbitrary URL or a private asset. */
export async function resolveAvailableArcMediaAsset(
  orgId: string,
  assetId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<{ id: string; public_url: string; storage_path: string; kind: string; risk_flags: string[] } | null> {
  const { data, error } = await client
    .from("media_assets" as string)
    .select("id, public_url, storage_path, kind, risk_flags")
    .eq("org_id", orgId)
    .eq("id", assetId)
    .eq("available_to_arc", true)
    .maybeSingle();
  if (error) throw new Error(`resolve arc media failed: ${error.message}`);
  if (!data) return null;
  const row = data as { id: string; public_url: string; storage_path: string; kind: string; risk_flags: string[] | null };
  return { ...row, risk_flags: row.risk_flags ?? [] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/media-library/arc-handoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-library/arc-handoff.ts src/lib/media-library/arc-handoff.test.ts
git commit -m "feat(arc): library read helpers for available_to_arc media"
```

---

### Task B2: `GET /api/v1/arc/media` endpoint

Bearer + Supabase + workspace gated via `arcGuard`, mirroring `src/app/api/v1/arc/brand/context/route.ts`.

**Files:**
- Create: `src/app/api/v1/arc/media/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { arcGuard, fail, ok } from "@/app/api/v1/arc/_lib/http";
import { listAvailableArcMedia } from "@/lib/media-library/arc-handoff";

/**
 * The org's Library media that the operator has marked available_to_arc, so Arc
 * can reuse authentic approved BSR media instead of always generating new AI
 * images. Read-only.
 *
 *   GET /api/v1/arc/media?kind=image&limit=50  ->  { ok, media: ArcMediaSummary[] }
 */
export async function GET(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind")?.trim() || undefined;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  try {
    const media = await listAvailableArcMedia(allowed.scope.orgId, { kind, limit });
    return ok({ media });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to list media.", 502);
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm build`
Expected: build succeeds (no type errors). `pnpm lint` alone does NOT typecheck — `pnpm build` is the gate.

- [ ] **Step 3: Behavioral sanity check (manual, optional if Supabase env present)**

Run (Supabase + `ARC_AGENT_API_TOKEN` configured locally):
```bash
curl -s -H "Authorization: Bearer $ARC_AGENT_API_TOKEN" "http://localhost:3000/api/v1/arc/media?limit=5" | head
```
Expected: `{"ok":true,"status":"ok","media":[...]}`. Without a token → `401 unauthorized`. Without Supabase env → `503 not_configured`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/arc/media/route.ts
git commit -m "feat(arc): GET /api/v1/arc/media lists available_to_arc library assets"
```

---

### Task B3: `POST /api/v1/arc/library/attach` endpoint

Server-resolves + validates the asset, then reuses `promoteAssetToCampaign` (already supports `libraryAssetId`) and `createCampaignShell`. Mirrors `src/app/api/v1/arc/campaigns/draft-asset/route.ts`.

**Files:**
- Create: `src/app/api/v1/arc/library/attach/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { INVALID_JSON, arcGuard, fail, ok, readJson } from "@/app/api/v1/arc/_lib/http";
import { createCampaignShell, promoteAssetToCampaign } from "@/lib/campaigns/create";
import { resolveAvailableArcMediaAsset } from "@/lib/media-library/arc-handoff";

/**
 * Attach a REAL Library asset (available_to_arc) to a campaign as an
 * approval-gated draft asset — the approval-safe path for reusing authentic BSR
 * media. The asset is resolved + validated server-side (org-scoped, must be
 * available_to_arc), so Arc can never attach an arbitrary URL or a private file.
 * Author is always "Arc"; the asset stays pending_approval + dispatch_locked.
 *
 *   POST /api/v1/arc/library/attach
 *   { library_asset_id, title, asset_type?,
 *     campaign_id? | (name + persona + restoration_focus) }
 *   -> 201 { ok, status:"created", campaignId, assetId, media }
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;
  const tenant = { org_id: allowed.scope.orgId, workspace_id: allowed.scope.workspaceId };

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const libraryAssetId = str(body.library_asset_id);
  const title = str(body.title);
  const assetType = str(body.asset_type) || "social_ad";
  if (!libraryAssetId) return fail("rejected", "library_asset_id is required.", 400);
  if (!title) return fail("rejected", "title is required.", 400);

  try {
    const asset = await resolveAvailableArcMediaAsset(allowed.scope.orgId, libraryAssetId);
    if (!asset) return fail("not_found", "No library asset with that id is available to Arc.", 404);

    let campaignId = str(body.campaign_id);
    if (!campaignId) {
      const name = str(body.name);
      const persona = str(body.persona);
      const restorationFocus = str(body.restoration_focus);
      if (!name || !persona || !restorationFocus) {
        return fail(
          "rejected",
          "To create a new campaign, name, persona, and restoration_focus are required (or pass campaign_id to attach to an existing campaign).",
          400,
        );
      }
      const shell = await createCampaignShell({ operator: "Arc", name, persona, restorationFocus, agentName: "Arc", tenant });
      campaignId = shell.campaignId;
    }

    const promoted = await promoteAssetToCampaign({
      operator: "Arc",
      campaignId,
      assetType,
      title,
      body: null,
      mediaUrl: asset.public_url,
      mediaPath: asset.storage_path,
      media: { source: "bsr_real", libraryAssetId, riskFlags: asset.risk_flags },
      agentName: "Arc",
      tenant,
    });

    const media = {
      kind: asset.kind === "video" ? "video" : "image",
      url: asset.public_url,
      source: "bsr_real",
      sourceId: libraryAssetId,
      status: "draft",
      ...(asset.risk_flags.length ? { riskFlags: asset.risk_flags } : {}),
    };

    return ok({ campaignId, assetId: promoted.assetId, media }, 201);
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to attach library media.", 502);
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm build`
Expected: build succeeds. Confirms `promoteAssetToCampaign`'s `media.libraryAssetId` field and `createCampaignShell`'s signature match the call sites above.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/arc/library/attach/route.ts
git commit -m "feat(arc): POST /api/v1/arc/library/attach attaches real media to a draft"
```

---

### Task B4: Runner tools `list_media` + `attach_media`

`list_media` is a read tool (available in every mode); `attach_media` is a draft tool (draft/act only) that emits an approval card. Mirrors `apps/arc-runner/src/tools/media.ts` and its test.

**Files:**
- Create: `apps/arc-runner/src/tools/library.ts`
- Create: `apps/arc-runner/src/tools/library.test.ts`
- Modify: `apps/arc-runner/src/tools/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/arc-runner/src/tools/library.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { ArcClient } from "../arc-client";
import type { ArcActionCard } from "../types";
import { libraryDraftTools, libraryReadTools } from "./library";

describe("list_media", () => {
  it("is named list_media and GETs the media endpoint with filters", async () => {
    const apiGet = vi.fn(async () => ({ media: [{ id: "a1", fileName: "x.jpg" }] }));
    const client = { apiGet } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const [listMedia] = libraryReadTools(client, step);
    expect(listMedia.name).toBe("list_media");

    const handler = listMedia.handler as (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
    const out = await handler({ kind: "image", limit: 5 });

    expect(apiGet).toHaveBeenCalledWith("/api/v1/arc/media", { kind: "image", limit: 5 });
    expect(out.content[0].text).toContain("a1");
  });
});

describe("attach_media", () => {
  it("is named attach_media, POSTs the attach endpoint, and emits a draft card", async () => {
    const media = { kind: "image", url: "https://x/y.jpg", source: "bsr_real", sourceId: "a1" };
    const apiPost = vi.fn(async () => ({ campaignId: "c1", assetId: "as1", media }));
    const client = { apiPost } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const cards: ArcActionCard[] = [];
    const [attachMedia] = libraryDraftTools(client, step, (c) => cards.push(c));

    const handler = attachMedia.handler as (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
    const out = await handler({ library_asset_id: "a1", title: "Before/after", campaign_id: "c1" });

    expect(apiPost).toHaveBeenCalledWith(
      "/api/v1/arc/library/attach",
      expect.objectContaining({ library_asset_id: "a1", title: "Before/after", campaign_id: "c1" }),
    );
    expect(cards[0]).toMatchObject({
      kind: "draft",
      title: "Before/after",
      media,
      approval: { kind: "campaign", campaignId: "c1", assetId: "as1" },
    });
    expect(out.content[0].text).toContain("as1");
  });

  it("emits no card when the attach POST fails", async () => {
    const apiPost = vi.fn(async () => {
      throw new Error("not available");
    });
    const client = { apiPost } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const cards: ArcActionCard[] = [];
    const [attachMedia] = libraryDraftTools(client, step, (c) => cards.push(c));
    const handler = attachMedia.handler as (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
    const out = await handler({ library_asset_id: "a1", title: "T", campaign_id: "c1" });
    expect(cards).toHaveLength(0);
    expect(out.content[0].text).toContain("failed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test apps/arc-runner/src/tools/library.test.ts`
Expected: FAIL — `Cannot find module './library'` / exports not defined.

- [ ] **Step 3: Implement the tools**

Create `apps/arc-runner/src/tools/library.ts`:

```ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import type { ArcActionCard, ArcMedia } from "../types";
import { runTool, textResult, type StepFn } from "./helpers";

/**
 * Library media tools. `list_media` lets Arc SEE the operator's real, approved
 * BSR media (available_to_arc) so it can reuse authentic proof instead of always
 * generating AI images. `attach_media` puts one of those real assets on a
 * campaign draft for approval — the asset is validated server-side and stays
 * pending_approval. Never outbound.
 */
export function libraryReadTools(client: ArcClient, step: StepFn) {
  const listMedia = tool(
    "list_media",
    "List REAL BSR media in the operator's Library that is available to you (photos, video, logos, docs the operator marked available_to_arc). Use this to find and REUSE authentic approved media instead of generating a new AI image. Returns each asset's id, file name, kind, dimensions, tags, and risk flags. To put one on a campaign draft for approval, call attach_media with its id. Optionally filter by kind (image | video | logo | document).",
    {
      kind: z.string().optional().describe("Filter by kind: image | video | logo | document"),
      limit: z.number().optional().describe("Max assets to return (default 50)"),
    },
    async (args) =>
      runTool(step, "Reading library", () =>
        client.apiGet("/api/v1/arc/media", { kind: args.kind, limit: args.limit }),
      ),
  );
  return [listMedia];
}

export function libraryDraftTools(client: ArcClient, step: StepFn, collectCard: (card: ArcActionCard) => void) {
  const attachMedia = tool(
    "attach_media",
    "Attach a REAL Library asset (by id from list_media) to a campaign as an approval-gated draft asset — the approval-safe way to reuse authentic BSR photos/video. Provide library_asset_id and a short title. Attach to an existing campaign with campaign_id, OR start a new draft campaign with name + persona (a persona key) + restoration_focus. The asset stays pending approval and never goes outbound.",
    {
      library_asset_id: z.string().describe("Asset id from list_media"),
      title: z.string().describe("Short title for the attached asset"),
      asset_type: z.string().optional().describe("default social_ad"),
      campaign_id: z.string().optional().describe("Existing campaign to attach to; omit to create a new draft campaign"),
      name: z.string().optional().describe("New campaign name (when campaign_id omitted)"),
      persona: z.string().optional(),
      restoration_focus: z.string().optional(),
    },
    async (args) => {
      const label = "Attaching media";
      await step(label, "running");
      try {
        const res = await client.apiPost<{ campaignId: string; assetId: string; media: ArcMedia }>(
          "/api/v1/arc/library/attach",
          {
            library_asset_id: args.library_asset_id,
            title: args.title,
            asset_type: args.asset_type,
            campaign_id: args.campaign_id,
            name: args.name,
            persona: args.persona,
            restoration_focus: args.restoration_focus,
          },
        );
        await step(label, "done");
        collectCard({
          kind: "draft",
          title: args.title,
          rows: [],
          flags: [],
          media: res.media,
          approval: { kind: "campaign", campaignId: res.campaignId, assetId: res.assetId },
        });
        return textResult(
          JSON.stringify({
            campaignId: res.campaignId,
            assetId: res.assetId,
            media: res.media,
            status: "library asset attached, pending approval",
          }),
        );
      } catch (error) {
        await step(label, "done");
        return textResult(`${label} failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    },
  );
  return [attachMedia];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test apps/arc-runner/src/tools/library.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Register the tools in the runner**

Modify `apps/arc-runner/src/tools/index.ts`:

Add the import after the other tool imports (near line 12):

```ts
import { libraryDraftTools, libraryReadTools } from "./library";
```

In `readTools(...)` add `list_media` to the returned array (so Arc can reference media in every mode). After `...intelligenceTools(client, step),`:

```ts
    ...libraryReadTools(client, step),
```

In `draftTools(...)` add `attach_media`. After `...mediaTools(client, step, sink.card, ctx),`:

```ts
    ...libraryDraftTools(client, step, sink.card),
```

(`allowedToolNames` is derived from `toolsForMode`, so both tools register automatically — no other edit needed.)

- [ ] **Step 6: Type-check the runner + full test pass**

Run: `pnpm build` (root) and `pnpm test apps/arc-runner/src/tools/`
Expected: build succeeds; runner tool tests pass. The tool arrays use spread (not push) so the widened union type holds — confirm no TS invariance error in `index.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/arc-runner/src/tools/library.ts apps/arc-runner/src/tools/library.test.ts apps/arc-runner/src/tools/index.ts
git commit -m "feat(arc): list_media + attach_media runner tools for library reuse"
```

---

## Part A — Unify the Library + Brand UI

### Task A1: Remove the top-level Brand nav entry

**Files:**
- Modify: `src/app/_components/console-frame.tsx:111`

- [ ] **Step 1: Delete the Brand nav item**

In `intelligenceNavItems` (around line 108-113), remove this line:

```ts
    { label: "Brand", href: "/brand", icon: "brand", matches: ["/brand"] },
```

Leaving:

```ts
  const intelligenceNavItems: ShellNavItem[] = [
    { label: "Activity", href: "/activity", icon: "activity", matches: ["/activity"] },
    { label: "Analytics", href: "/analytics", icon: "analytics", matches: ["/analytics"] },
    { label: "Brain", href: "/brain", icon: "brain", matches: ["/brain"] },
  ];
```

Do NOT touch `BrandMark`/`BrandWordmark` or the `/brand/arc-mark.png` / `/brand/arc-wordmark.png` asset paths — those are static `public/` files, unrelated to the route.

- [ ] **Step 2: Verify the nav still renders every other entry**

Run: `pnpm build`
Expected: build succeeds. Then visually confirm in Step A4's preview that the sidebar shows Today, Arc, Campaigns, CRM, Opportunities, Activity, Analytics, Brain, Gallery, Library, Outbox, Board (Brand gone). This array is a known merge-collision hotspot — confirm no sibling entry was dropped.

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/console-frame.tsx
git commit -m "feat(library): drop standalone Brand nav entry (folds into Library)"
```

---

### Task A2: Relocate the brand-kit route to `/library/brand` with a redirect from `/brand`

A mechanical move of the route folder, plus a redirect stub. Relative `./_components` and `../actions` imports survive because the folder moves as a unit; absolute `@/app/brand/...` references are fixed by grep.

**Files:**
- Move: `src/app/brand/page.tsx` → `src/app/library/brand/page.tsx`
- Move: `src/app/brand/_components/` → `src/app/library/brand/_components/`
- Move: `src/app/brand/actions.ts` → `src/app/library/brand/actions.ts`
- Create: `src/app/brand/page.tsx` (redirect stub)
- Modify: any file importing `@/app/brand/*` (found via grep in Step 2)

- [ ] **Step 1: Move the route folder contents with git**

```bash
mkdir -p src/app/library/brand
git mv src/app/brand/_components src/app/library/brand/_components
git mv src/app/brand/actions.ts src/app/library/brand/actions.ts
git mv src/app/brand/page.tsx src/app/library/brand/page.tsx
```

If `src/app/brand/` holds any other files (e.g. `layout.tsx`, `_data/`), `git mv` those into `src/app/library/brand/` too. Confirm what exists first: `ls src/app/brand`.

- [ ] **Step 2: Find and fix absolute imports of the old path**

Run: `git grep -n "app/brand/" -- 'src/**' 'apps/**'`
Expected: a list of any `@/app/brand/actions` / `@/app/brand/_components/...` imports (e.g. from the Arc chat composer or other routes).
For each hit, rewrite `@/app/brand/` → `@/app/library/brand/`. Re-run the grep until it returns no matches **except** the static `public/brand/*.png` references in `console-frame.tsx` (those are correct — leave them).

- [ ] **Step 3: Create the redirect stub at the old route**

Create `src/app/brand/page.tsx`:

```tsx
import { redirect } from "next/navigation";

/** The brand kit now lives inside the Library. Keep /brand working for old links. */
export default function BrandRedirect() {
  redirect("/library/brand");
}
```

Before writing, confirm the Next.js 16 redirect API: read `node_modules/next/dist/docs/` for the current `redirect` guidance (AGENTS.md: this is not the Next.js you know). `redirect` from `next/navigation` is the App Router server-component form; adjust only if the shipped docs say otherwise.

- [ ] **Step 4: Verify type-check + the moved page compiles at its new path**

Run: `pnpm build`
Expected: build succeeds. The moved `library/brand/page.tsx` keeps its `@/...` imports (unaffected by the move) and its `./_components/*` imports (folder moved with it).

- [ ] **Step 5: Commit**

```bash
git add -A src/app/brand src/app/library/brand
git commit -m "feat(library): move brand kit under /library/brand, redirect /brand"
```

---

### Task A3: Add the "Assets · Brand" segmented control

A shared tab control rendered at the top of both `/library` and `/library/brand`, using existing theme primitives (no bare `--surface` token — use `--surface-inset` / `--surface-raised`, which are valid theme vars).

**Files:**
- Create: `src/app/library/_components/library-tabs.tsx`
- Modify: `src/app/library/page.tsx`
- Modify: `src/app/library/brand/page.tsx`

- [ ] **Step 1: Create the tab control**

Create `src/app/library/_components/library-tabs.tsx`:

```tsx
import Link from "next/link";

import { cx } from "@/app/_components/theme";

/** Segmented control switching between the asset grid (/library) and the brand
 *  kit (/library/brand) — the two views of the unified Library section. */
export function LibraryTabs({ active }: { active: "assets" | "brand" }) {
  const tab = (href: string, key: "assets" | "brand", label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={cx(
        "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
        active === key
          ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-inset)] p-1">
      {tab("/library", "assets", "Assets")}
      {tab("/library/brand", "brand", "Brand")}
    </div>
  );
}
```

- [ ] **Step 2: Render the tabs on the Library page**

In `src/app/library/page.tsx`, add the import:

```ts
import { LibraryTabs } from "./_components/library-tabs";
```

Then render `<LibraryTabs active="assets" />` immediately inside the returned fragment, before `<PageHeader ... />`, in BOTH the `unavailable` branch and the main return. For the main return:

```tsx
  return (
    <>
      <LibraryTabs active="assets" />
      <PageHeader
        title="Library"
        ...
```

- [ ] **Step 3: Render the tabs on the Brand page**

In `src/app/library/brand/page.tsx`, add the import (note the path is now one level under `library`):

```ts
import { LibraryTabs } from "../_components/library-tabs";
```

Then render it as the first child of the page's root element, before `<PageHeader ... />`:

```tsx
  return (
    <div className="flex flex-col gap-6">
      <LibraryTabs active="brand" />
      <PageHeader
        ...
```

- [ ] **Step 4: Type-check**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Verify in the browser**

Start the preview (preview_start if needed). Then:
- Visit `/library` → "Assets" tab active, asset grid renders, sidebar has no "Brand" entry.
- Click "Brand" → lands on `/library/brand`, brand kit renders, "Brand" tab active.
- Visit `/brand` directly → redirects to `/library/brand`.
- Confirm `/brand/arc-mark.png` still loads (sidebar logo visible) — the redirect must not shadow the static asset.

Capture a screenshot of `/library` with the tabs for the PR.

- [ ] **Step 6: Commit**

```bash
git add src/app/library/_components/library-tabs.tsx src/app/library/page.tsx src/app/library/brand/page.tsx
git commit -m "feat(library): Assets/Brand segmented control across the unified section"
```

---

## Deferred (explicit phase 2 — not in this plan)

- **Brand-source filter in the asset grid.** A "Brand sources" filter chip in `asset-grid.tsx`. The brand-source *view* already exists on `/library/brand`; a redundant grid filter is a nice-to-have, deferred to keep this plan focused.
- **Image assets → knowledge graph.** Feeding image media into `knowledge_nodes` so Arc *proactively* suggests campaigns around them (the brainstorm's option B). Larger ingestion work; revisit after this ships.

## Final verification (before opening the PR)

- [ ] Run the full test suite: `pnpm test` — expect green.
- [ ] Run `pnpm build` — expect a clean production build (catches typed-Supabase-enum / RSC prop errors that lint misses).
- [ ] Rebase on fresh `origin/main` and regenerate the lockfile locally if needed (`pnpm install`) — never resolve `pnpm-lock.yaml` conflicts in GitHub's web editor.
- [ ] After merging to main, run `pnpm build` (tsc) on main once more — shared payload types (`AssetMediaProvenance`, the Arc media DTO) can pass on a branch but break main's tsc on merge.
- [ ] Remember prod Supabase is `qqbecyrhnowmooyjiztz`; no migration ships in this plan, but confirm `available_to_arc` and `campaign_assets.audit_payload.library_asset_id` exist in prod before relying on the attach flow there.
