import { describe, expect, it } from "vitest";

import {
  ArcMessageError,
  arcAssetStatusFromDb,
  cleanApprovableDrafts,
  deriveThreadTitle,
  parseActions,
  parseMedia,
  parseMentions,
  serializeMentions,
  validateArcMessageInput,
  type ArcMention,
} from "../arc-chat";

const mention: ArcMention = { type: "campaign", id: "c1", label: "Roof storm push", href: "/campaigns/c1" };

describe("parseMedia", () => {
  it("keeps valid image/video items with their optional fields", () => {
    const out = parseMedia([
      { kind: "image", url: "https://x/a.png", caption: "Hero", alt: "alt" },
      { kind: "video", url: "https://x/b.mp4", poster: "https://x/p.jpg" },
    ]);
    expect(out).toEqual([
      { kind: "image", url: "https://x/a.png", caption: "Hero", alt: "alt" },
      { kind: "video", url: "https://x/b.mp4", poster: "https://x/p.jpg" },
    ]);
  });
  it("parses a JSON string", () => {
    expect(parseMedia(JSON.stringify([{ kind: "image", url: "https://x/a.png" }]))).toEqual([
      { kind: "image", url: "https://x/a.png" },
    ]);
  });
  it("drops items with an invalid kind or missing url, and junk input", () => {
    expect(parseMedia([{ kind: "gif", url: "https://x/a.gif" }, { kind: "image" }])).toEqual([]);
    expect(parseMedia("nope")).toEqual([]);
    expect(parseMedia(null)).toEqual([]);
  });
});

describe("deriveThreadTitle", () => {
  it("uses the first line, trimmed and collapsed", () => {
    expect(deriveThreadTitle("  How is   the roof storm push doing?  ")).toBe("How is the roof storm push doing?");
  });
  it("truncates long messages on a word boundary with an ellipsis", () => {
    const title = deriveThreadTitle("Compare the insurance agent persona against last month numbers and tell me everything");
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
  });
  it("falls back to 'New chat' for empty input", () => {
    expect(deriveThreadTitle("   ")).toBe("New chat");
  });
});

describe("validateArcMessageInput", () => {
  it("returns trimmed body and mentions for valid input", () => {
    const out = validateArcMessageInput({ body: "  hi mark  ", mentions: [mention] });
    expect(out).toEqual({ body: "hi mark", mentions: [mention] });
  });
  it("throws ArcMessageError on empty body", () => {
    expect(() => validateArcMessageInput({ body: "   ", mentions: [] })).toThrow(ArcMessageError);
  });
  it("throws ArcMessageError when over the length cap", () => {
    expect(() => validateArcMessageInput({ body: "x".repeat(4001), mentions: [] })).toThrow(ArcMessageError);
  });
  it("drops malformed mentions rather than throwing", () => {
    const out = validateArcMessageInput({ body: "hi", mentions: [mention, { type: "campaign" } as unknown as ArcMention] });
    expect(out.mentions).toEqual([mention]);
  });
});

describe("serializeMentions / parseMentions", () => {
  it("round-trips a list of mentions", () => {
    expect(parseMentions(serializeMentions([mention]))).toEqual([mention]);
  });
  it("parses a JSON string", () => {
    expect(parseMentions(JSON.stringify([mention]))).toEqual([mention]);
  });
  it("returns [] for junk", () => {
    expect(parseMentions("not json")).toEqual([]);
    expect(parseMentions(null)).toEqual([]);
    expect(parseMentions([{ nope: true }])).toEqual([]);
  });
});

describe("parseActions — one asset, one card", () => {
  const ASSET = "f477ea65-7b16-4056-8c77-a35931825cf6";
  const draft = (title: string, assetId = ASSET, status?: string) => ({
    kind: "draft",
    title,
    channel: "Email",
    ...(status ? { status } : {}),
    approval: { kind: "campaign", campaignId: "camp-1", assetId },
  });

  // The exact shape Arc emitted on prod: it saved the asset, then restated it,
  // producing two cards with the SAME assetId. DraftPackageCard renders
  // cards.length, so one asset read as "2 assets ready for review · 0/2 approved".
  it("collapses a restated draft into a single card", () => {
    const cards = parseActions([
      draft("Send-pipeline verification email"),
      draft("Send-pipeline verification email — pending approval"),
    ]);

    expect(cards).toHaveLength(1);
  });

  it("keeps the later payload — it carries the settled status", () => {
    const cards = parseActions([draft("Draft"), draft("Draft — pending approval", ASSET, "approved")]);

    expect(cards[0].title).toBe("Draft — pending approval");
    expect(cards[0].status).toBe("approved");
  });

  it("keeps the original position so a restatement can't reorder the deck", () => {
    const cards = parseActions([
      draft("A", "asset-a"),
      draft("B", "asset-b"),
      draft("A again", "asset-a"),
    ]);

    expect(cards.map((c) => c.title)).toEqual(["A again", "B"]);
  });

  it("never merges cards for different assets", () => {
    const cards = parseActions([draft("One", "asset-1"), draft("Two", "asset-2")]);

    expect(cards).toHaveLength(2);
  });

  // A result/navigate card has no assetId, so there is no stable identity to key
  // on — guessing one would collapse genuinely distinct cards.
  it("leaves approval-less cards alone, even when they look alike", () => {
    const cards = parseActions([
      { kind: "result", title: "Same title" },
      { kind: "result", title: "Same title" },
    ]);

    expect(cards).toHaveLength(2);
  });

  // The real hazard beyond the miscount: bulk-approve reads the same card list.
  // The context here is what makes the asset eligible at all — a recorded pass
  // and loaded, empty findings — so what this asserts is the DEDUPE: one asset
  // comes back once, not twice.
  it("stops bulk-approve seeing one asset twice", () => {
    const cards = parseActions([
      draft("Send-pipeline verification email"),
      draft("Send-pipeline verification email — pending approval"),
    ]).map((card) => ({ ...card, flags: [{ tone: "ok" as const, label: "No banned phrase detected" }] }));

    expect(cleanApprovableDrafts(cards, { checks: { [ASSET]: [] } })).toEqual([
      { campaignId: "camp-1", assetId: ASSET },
    ]);
  });
});

describe("arcAssetStatusFromDb", () => {
  // The chat card carries the status Arc froze at DRAFT time. Without a live
  // lookup, deciding an asset on the campaign page never reached the
  // conversation: it kept showing "Needs review" for assets approved and sent
  // hours earlier, and the `n need review` chip counted work that was gone.
  it("maps decided states so they stop counting as review work", () => {
    expect(arcAssetStatusFromDb("approved")).toBe("approved");
    expect(arcAssetStatusFromDb("declined")).toBe("rejected");
    expect(arcAssetStatusFromDb("rejected")).toBe("rejected");
  });

  // `archived` says the work is CLOSED, not how it was decided. Mapping it
  // straight to "rejected" made the chat label an archived-but-approved email
  // "Declined" — on prod, on an asset that had actually been approved and
  // DELIVERED with a Resend message id. approved_at is the human's signature, so
  // it decides which way an archived asset reads.
  it("resolves archived from approved_at, never assuming a rejection", () => {
    expect(arcAssetStatusFromDb("archived", "2026-07-22T19:01:27Z")).toBe("approved");
    expect(arcAssetStatusFromDb("archived", null)).toBe("rejected");
    expect(arcAssetStatusFromDb("archived")).toBe("rejected");
  });

  it("ignores approved_at for statuses that already state the decision", () => {
    // A declined asset with a stale approved_at is still declined.
    expect(arcAssetStatusFromDb("declined", "2026-07-22T19:01:27Z")).toBe("rejected");
    expect(arcAssetStatusFromDb("pending_approval", "2026-07-22T19:01:27Z")).toBe("draft");
  });

  it("keeps genuinely-undecided states as review work", () => {
    for (const s of ["draft", "pending_approval", "pending_owner_approval", "needs_compliance", "blocked"]) {
      expect(arcAssetStatusFromDb(s), s).toBe("draft");
    }
  });

  it("maps both revision spellings the schema uses", () => {
    expect(arcAssetStatusFromDb("revision_requested")).toBe("revision");
    expect(arcAssetStatusFromDb("needs_revision")).toBe("revision");
  });

  // An unmapped status must return null, not a guess: the caller omits the id so
  // the card falls back to its snapshot rather than being told a wrong state.
  it("returns null for anything it doesn't recognise", () => {
    for (const s of ["", "  ", "nonsense", null, undefined]) {
      expect(arcAssetStatusFromDb(s as string)).toBeNull();
    }
  });

  it("covers every value in the campaign_assets status enum", () => {
    // Mirrors the DB enum. A new status added there without a mapping here would
    // silently fall back to the stale snapshot — the exact bug this replaces.
    const dbEnum = [
      "draft", "needs_compliance", "pending_approval", "pending_owner_approval",
      "approved", "declined", "rejected", "revision_requested", "blocked",
      "needs_revision", "archived",
    ];
    for (const s of dbEnum) expect(arcAssetStatusFromDb(s), `${s} unmapped`).not.toBeNull();
  });
});
