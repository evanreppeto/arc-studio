import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VIEW_SOURCE = readFileSync(
  new URL("../../app/(app)/arc/_components/arc-view.tsx", import.meta.url),
  "utf8",
);
const CSS_SOURCE = readFileSync(
  new URL("../../app/(app)/arc/arc.css", import.meta.url),
  "utf8",
);
/* The conversation sidebar. It lives in the shared app shell rather than in
   /arc, because it is on every route — which is the point of moving the chat
   list there and deleting the drawer's second copy of it. */
const RAIL_SOURCE = readFileSync(
  new URL("../../app/(app)/_components/rail-recents.tsx", import.meta.url),
  "utf8",
);
const SHELL_SOURCE = readFileSync(
  new URL("../../app/(app)/_components/app-shell.tsx", import.meta.url),
  "utf8",
);
const DEMO_SOURCE = readFileSync(
  new URL("../../app/(app)/arc/_components/arc-demo-data.ts", import.meta.url),
  "utf8",
);

describe("Arc UI accessibility contract", () => {
  it("exposes the resolved workspace capability beside the composer", () => {
    expect(VIEW_SOURCE).toContain("arc-mode-button");
    expect(VIEW_SOURCE).toContain("Capability: ${capabilityLabel}");
    expect(VIEW_SOURCE).toContain('aria-label={composerMenu === "commands" ? "Skills menu" : composerMenu === "mode" ? "Capability menu"');
  });

  it("keeps the icon-only mobile review action named, in the shared vocabulary", () => {
    // The visible chip and its accessible name must agree, and both must use the
    // one label for this state — the chip said "need review" while every pill it
    // pointed at said "Needs you" (BSR-656).
    expect(VIEW_SOURCE).toContain('aria-label={`${needsReviewCards.length} items need you`}');
    expect(VIEW_SOURCE).toContain('<span>{needsReviewCards.length} need you</span>');
  });

  it("does not steal the global Command-K shortcut for drawer search", () => {
    expect(VIEW_SOURCE).not.toContain("event.metaKey || event.ctrlKey");
    expect(VIEW_SOURCE).not.toContain("⌘K");
  });

  it("keeps phone drawer actions visible and touch-sized", () => {
    expect(CSS_SOURCE).toContain(".arc-history-menu-btn { width: 44px; height: 44px; margin-right: 0; opacity: 1; }");
    // The drawer runs on one type scale (`--dz-*` on `.arc-history`); on phones
    // the nav steps up one rung from the base `--dz-xs` for touch. Asserting the
    // token rather than a literal keeps this from breaking every time the scale
    // is retuned — the contract is "bigger than the desktop size", not "10.5px".
    expect(CSS_SOURCE).toContain(".arc-drawer-nav button { font-size: var(--dz-sm); }");
    expect(CSS_SOURCE).toContain(".arc-drawer-nav button { flex: 1 1 auto;");
  });

  it("keeps mobile safety visible while shrinking the context ring inside its tap target", () => {
    expect(CSS_SOURCE).toContain(".arc-mode-button small { display: inline; font-size: 8px; }");
    expect(CSS_SOURCE).toContain(".arc-context-meter { --arc-context-ring: 21px; min-height: 44px; }");
    expect(VIEW_SOURCE).toContain("Automatic → {capabilityLabel}");
  });

  it("uses compact composer popovers", () => {
    expect(CSS_SOURCE).toContain("width: min(310px, calc(100% - 22px));");
    expect(CSS_SOURCE).toContain("width: min(272px, calc(100% - 56px));");
    expect(CSS_SOURCE).toContain("width: min(190px, calc(100vw - 28px));");
  });

  it("never prefetches the blank-chat transition and explains live history failures", () => {
    // The "New" control moved to the rail with the list it starts a row in.
    // Prefetching it would warm a route whose whole job is to be empty.
    expect(SHELL_SOURCE).toContain('href="/arc?new=1"');
    expect(SHELL_SOURCE).toContain("prefetch={false}");
    expect(VIEW_SOURCE).toContain("History is temporarily unavailable.");
    expect(VIEW_SOURCE).toContain("live && historyLoadError");
  });

  it("never calls a connector that was only ever off 'Paused'", () => {
    // `disabled` is simply `!enabled`. Calling it "Paused" told operators a
    // connector had been running and got suspended, which on a fresh workspace
    // was true of nothing and shown on every row.
    expect(VIEW_SOURCE).toContain('if (status === "disabled") return "Off";');
    expect(VIEW_SOURCE).toContain('if (status === "unavailable") return "Not available yet";');
    expect(VIEW_SOURCE).not.toContain('return "Paused"');
  });

  it("switches connectors through the shared Settings action, not a second write path", () => {
    // The operator gate, org scoping and upsert behaviour must stay in one
    // place; the drawer adds a control, not another way into the rows.
    expect(VIEW_SOURCE).toContain('import { toggleConnectorEnabled } from "../../settings/connectors-actions"');
    expect(VIEW_SOURCE).toContain("toggleConnectorEnabled({ connectorKey: connector.key, enabled: !connector.enabled })");
    // A switch that silently fails to save is the failure this surface removes.
    expect(VIEW_SOURCE).toContain("else if (!result.persisted) setConnectorError(");
  });

  it("declares the workspace drawer a modal dialog and lets Escape out of it", () => {
    // It always behaved as one — the scrim takes pointer events and covers the
    // conversation — while declaring none of it.
    expect(VIEW_SOURCE).toContain('role="dialog" aria-modal="true" aria-label="Arc workspace"');
    expect(VIEW_SOURCE).toContain('if (!dismissInnermost()) onDismiss();');
    // On `document`, not the aside: dismissing an inner surface unmounts the
    // element that had focus, and a handler on the aside would then never fire
    // again — Escape would work exactly once.
    expect(VIEW_SOURCE).toContain('document.addEventListener("keydown", onKeyDown, true);');
    expect(VIEW_SOURCE).toContain("if (!inside) {");
    // The trigger advertises what it opens, and gets focus back on dismissal.
    expect(VIEW_SOURCE).toContain('aria-expanded={historyOpen} aria-haspopup="dialog"');
    expect(VIEW_SOURCE).toContain("historyButtonRef.current?.focus();");
  });

  it("closes the drawer's innermost surface first, and only then the drawer", () => {
    // Capture phase specifically: a bubble-phase listener runs after React has
    // already unmounted the surface, so the DOM can no longer be asked.
    expect(VIEW_SOURCE).toContain('document.addEventListener("keydown", onKeyDown, true);');
    expect(VIEW_SOURCE).toContain("if (!dismissInnermost()) onDismiss();");
    expect(VIEW_SOURCE).toContain('if (view === "skills" && skillsMode === "library") { setSkillsMode("installed"); return true; }');
    // The drawer's own thread menu and rename field are gone with its
    // conversation list, and so is the guard that let them eat Escape first —
    // its two selectors matched nothing rendered anywhere once the list moved.
    expect(VIEW_SOURCE).not.toContain("if (targetOwnedByNestedSurface(event.target)) return;");
    // The rail's replacements own their own Escape, outside this modal.
    expect(RAIL_SOURCE).toContain('if (event.key === "Escape") setMenuOpen(false);');
    expect(RAIL_SOURCE).toContain('if (event.key === "Escape") { event.preventDefault(); event.stopPropagation();');
  });

  it("never hides a search hit inside a collapsed campaign folder", () => {
    // A folder only appears in a filtered list because it holds a match, so a
    // collapsed one would show a count with nothing under it — which reads as a
    // bug in search rather than a closed folder. The rail sidesteps the whole
    // class of it: it groups the ALREADY-filtered rows, so a folder only exists
    // because it holds a match — there is no collapse state for a search to
    // survive and no folder can show a count with nothing under it.
    expect(RAIL_SOURCE).toContain("const { folders, loose } = groupRailConversations(matches);");
    // Search reaches past the loaded rows, so a chat beyond the rail's read
    // budget is still findable by something said inside it.
    expect(RAIL_SOURCE).toContain("searchArcMessagesAction(query)");
  });


  it("assigns a campaign through the shared action, and reports at the control", () => {
    // One write path. The operator gate, access check and campaign-in-workspace
    // check stay where they are; the header adds a control, not a second way in.
    expect(VIEW_SOURCE).toContain("assignArcConversationCampaignAction({");
    expect(VIEW_SOURCE).toContain("conversationId: visibleConversationId,");

    // Optimistic, and put back on refusal — a chip that keeps a value the server
    // rejected is the one failure this control cannot be allowed to have.
    expect(VIEW_SOURCE).toContain("setCampaignOverride({ id: previous });");

    // The outcome belongs at the chip. Routing it to `composerNotice` would put
    // a header failure at the bottom of the screen beside the send button — the
    // distance-from-the-cause problem the per-message notices already fixed.
    expect(VIEW_SOURCE).toContain("setCampaignNotice(result.error);");
    expect(VIEW_SOURCE).toContain('<span className="arc-campaign-notice"');
  });

  it("lets the backend-less preview demonstrate the campaign picker", () => {
    // With no backend there are no mentionables, so the picker would render
    // empty and the control could not be reviewed on the surface it is reviewed
    // on. The fixture is the demo's own campaign list, and it is the same one
    // the rail labels its folders from — there used to be two, already drifted.
    expect(VIEW_SOURCE).toContain("live ? [] : DEMO_CAMPAIGNS");
    expect(DEMO_SOURCE).toContain("export const DEMO_CAMPAIGNS");
    expect(DEMO_SOURCE).toContain("DEMO_CAMPAIGNS.map((campaign) => [campaign.id, campaign.label])");
  });

  it("does not clamp connector copy into an unreadable stub", () => {
    // The old 2-line clamp cut settings prose mid-word in a 386px panel, and the
    // rest was unreachable. Rows size to the registry's one-line summary instead.
    expect(CSS_SOURCE).toContain(".arc-connector-copy p { margin: 0;");
    expect(VIEW_SOURCE).toContain("connector.capabilitySummary || connector.description");
  });
});
