import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArcClient } from "../arc-client";
import type { ArcActionCard } from "../types";
import { mediaTools } from "./media";

function setup(posts: Array<() => Promise<unknown>>) {
  const cards: ArcActionCard[] = [];
  let i = 0;
  const apiPost = vi.fn(async () => posts[i++]());
  const client = { apiPost } as unknown as ArcClient;
  const step = vi.fn(async () => {});
  const [genImage] = mediaTools(client, step, (c) => cards.push(c));
  const call = (args: Record<string, unknown>) =>
    (genImage.handler as (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)(args);
  return { cards, apiPost, call, genImage };
}

describe("generate_image", () => {
  it("is named generate_image", () => {
    const { genImage } = setup([async () => ({})]);
    expect(genImage.name).toBe("generate_image");
  });

  it("creates no campaign when the operator asked for just the image", async () => {
    // BSR-634. The tool used to create a campaign unconditionally, because until
    // generated media reached the Library a campaign was the only way an image
    // was reachable at all. Asking for "just one image, no campaign" produced a
    // campaign anyway — contradicting the operator and leaving junk behind.
    const media = { kind: "image", url: "https://x/y.png", source: "ai_generated", format: "4:3", model: "m", jobId: "j" };
    const { cards, apiPost, call } = setup([async () => ({ media, objectPath: "arc-generated/y.png" })]);

    const out = await call({ prompt: "a service van", title: "Van", library_only: true });

    // Generation happened; the draft-asset call did NOT.
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith("/api/v1/arc/media/generate-image", expect.objectContaining({ prompt: "a service van" }));
    const payload = JSON.parse(out.content[0]!.text) as { campaignId: string | null; status: string };
    expect(payload.campaignId).toBeNull();
    expect(payload.status).toMatch(/Library/i);
    // The card points at the Library and carries no approval — there is no
    // campaign asset to approve, and the Library holds it for review instead.
    expect(cards[0]).toMatchObject({ kind: "result", title: "Van", href: "/library", media });
    expect(cards[0]!.approval).toBeUndefined();
  });

  it("still attaches to a campaign the operator named, even with library_only set", async () => {
    // An explicit campaign_id is a clearer instruction than the flag.
    const media = { kind: "image", url: "https://x/y.png", source: "ai_generated", format: "1:1", model: "m", jobId: "j" };
    const { apiPost, call } = setup([
      async () => ({ media, objectPath: "arc-generated/y.png" }),
      async () => ({ campaignId: "c1", assetId: "a1" }),
    ]);

    await call({ prompt: "x", title: "T", library_only: true, campaign_id: "c1" });

    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost).toHaveBeenNthCalledWith(2, "/api/v1/arc/campaigns/draft-asset", expect.objectContaining({ campaign_id: "c1" }));
  });

  it("still creates a campaign by default, so nothing changes for normal campaign work", async () => {
    const media = { kind: "image", url: "https://x/y.png", source: "ai_generated", format: "1:1", model: "m", jobId: "j" };
    const { apiPost, call } = setup([
      async () => ({ media, objectPath: "arc-generated/y.png" }),
      async () => ({ campaignId: "c1", assetId: "a1" }),
    ]);

    await call({ prompt: "x", title: "T", name: "Spring push", persona: "persona_landlord" });

    expect(apiPost).toHaveBeenCalledTimes(2);
  });

  it("generates, creates a draft asset, and emits a media+approval card", async () => {
    const media = { kind: "image", url: "https://x/y.png", source: "ai_generated", format: "1:1", model: "m", jobId: "j" };
    const { cards, apiPost, call } = setup([
      async () => ({ media, objectPath: "arc-generated/y.png" }),
      async () => ({ campaignId: "c1", assetId: "a1" }),
    ]);
    const out = await call({ prompt: "blue gradient", title: "BG", name: "Brand", persona: "persona_landlord", restoration_focus: "water" });

    expect(apiPost).toHaveBeenNthCalledWith(1, "/api/v1/arc/media/generate-image", expect.objectContaining({ prompt: "blue gradient" }));
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      "/api/v1/arc/campaigns/draft-asset",
      expect.objectContaining({ media_url: "https://x/y.png", media_path: "arc-generated/y.png", title: "BG" }),
    );
    expect(cards[0]).toMatchObject({
      kind: "draft",
      title: "BG",
      media,
      approval: { kind: "campaign", campaignId: "c1", assetId: "a1" },
    });
    expect(out.content[0].text).toContain("a1");
  });

  it("emits no card when generation fails", async () => {
    const { cards, call } = setup([
      async () => {
        throw new Error("quota");
      },
    ]);
    const out = await call({ prompt: "x", title: "T", campaign_id: "c1" });
    expect(cards).toHaveLength(0);
    expect(out.content[0].text).toContain("failed");
  });

  it("forwards the turn's level on the generate-image POST when ctx provides it", async () => {
    const media = { kind: "image", url: "https://x/y.png", source: "ai_generated", format: "1:1", model: "m" };
    const posts: Array<() => Promise<unknown>> = [
      async () => ({ media, objectPath: "arc-generated/y.png" }),
      async () => ({ campaignId: "c1", assetId: "a1" }),
    ];
    let i = 0;
    const apiPost = vi.fn(async () => posts[i++]());
    const client = { apiPost } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const [genImage] = mediaTools(client, step, () => {}, { level: "standard" });
    const handler = genImage.handler as (
      a: Record<string, unknown>,
      e?: unknown,
    ) => Promise<{ content: Array<{ type: string; text: string }> }>;
    await handler({ prompt: "blue gradient", title: "BG", campaign_id: "c1" });
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/arc/media/generate-image",
      expect.objectContaining({ level: "standard" }),
    );
  });
});

function setupVideo(posts: Array<() => Promise<unknown>>) {
  const cards: ArcActionCard[] = [];
  let i = 0;
  const apiPost = vi.fn(async () => posts[i++]());
  const client = { apiPost } as unknown as ArcClient;
  const step = vi.fn(async () => {});
  const [, genVideo] = mediaTools(client, step, (c) => cards.push(c));
  const call = (args: Record<string, unknown>) =>
    (genVideo.handler as (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)(args);
  return { cards, apiPost, call, genVideo };
}

// BSR-706. Branding is the most common revision ask on an image asset and the
// one image generation can never satisfy: hardenImagePrompt strips text/logos
// from every prompt unconditionally, so "add our logo" regenerates a picture
// that still has no logo. compose_creative is the only path that puts the real
// Brand Kit logo on an image — but Arc only reaches for it if the descriptions
// say so. These assert the signposts, because without them the tools quietly
// point Arc at the tool that cannot do the job.
describe("branding revisions route to compositing, not regeneration", () => {
  const descriptions = () => {
    const client = { apiPost: vi.fn() } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const tools = mediaTools(client, step, () => {}, {});
    return Object.fromEntries(tools.map((t) => [t.name, t.description ?? ""]));
  };

  it("sends generate_image callers to compose_creative for logos and on-image words", () => {
    const generateImage = descriptions().generate_image;
    expect(generateImage).toMatch(/compose_creative/);
    // naming the replacement is the point — "added later in design" told Arc the
    // request was someone else's job without saying whose
    expect(generateImage).toMatch(/logo/i);
  });

  it("tells compose_creative it is the answer to a branding revision", () => {
    expect(descriptions().compose_creative).toMatch(/revision/i);
    expect(descriptions().compose_creative).toMatch(/background_url/);
  });

  it("states the lockup limit rather than letting the operator discover it", () => {
    // "put our logo on the truck" yields a branded creative, NOT a branded
    // truck — the logo is positioned by the layout, not painted into the scene.
    expect(descriptions().compose_creative).toMatch(/not painted onto an object|NOT painted onto an object/i);
  });
});

describe("compose_creative", () => {
  it("exposes compose_creative", () => {
    const client = { apiPost: vi.fn() } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const names = mediaTools(client, step, () => {}, {}).map((t) => t.name);
    expect(names).toContain("compose_creative");
  });

  it("calls generate-image with remapped aspect_ratio, composes, drafts, and returns assetId", async () => {
    const bgMedia = { kind: "image", url: "https://cdn/bg.png", source: "ai_generated" };
    const composedMedia = { kind: "image", url: "https://cdn/out.png", source: "composite", format: "4:5" };
    const cards: ArcActionCard[] = [];
    const apiPost = vi
      .fn()
      .mockResolvedValueOnce({ media: bgMedia })
      .mockResolvedValueOnce({ media: composedMedia, objectPath: "arc-composite/o/w/x.png", template: "bold" })
      .mockResolvedValueOnce({ campaignId: "c1", assetId: "a1" });
    const client = { apiPost } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const [, , composeCreative] = mediaTools(client, step, (c) => cards.push(c), { campaignId: "c1" });
    const handler = composeCreative.handler as (
      a: Record<string, unknown>,
      e?: unknown,
    ) => Promise<{ content: Array<{ type: string; text: string }> }>;

    const out = await handler({
      headline: "Flooded?",
      title: "WD social",
      prompt: "flooded living room, air movers",
      cta_label: "Call now",
      format: "4:5",
    });

    // 3 API calls total
    expect(apiPost).toHaveBeenCalledTimes(3);

    // 1st call: generate-image with remapped aspect_ratio 3:4 (not 4:5)
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/arc/media/generate-image",
      expect.objectContaining({ aspect_ratio: "3:4" }),
    );

    // 2nd call: compose with original format 4:5, background_url, and headline
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      "/api/v1/arc/media/compose",
      expect.objectContaining({ background_url: "https://cdn/bg.png", format: "4:5", headline: "Flooded?" }),
    );

    // 3rd call: draft-asset with composed media url and source
    expect(apiPost).toHaveBeenNthCalledWith(
      3,
      "/api/v1/arc/campaigns/draft-asset",
      expect.objectContaining({
        media_url: "https://cdn/out.png",
        media: expect.objectContaining({ source: "composite" }),
        title: "WD social",
      }),
    );

    // Result contains assetId and pending approval status
    expect(out.content[0].text).toContain("a1");
    expect(out.content[0].text).toContain("pending approval");
  });
});

describe("generate_video", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is named generate_video", () => {
    const { genVideo } = setupVideo([async () => ({})]);
    expect(genVideo.name).toBe("generate_video");
  });

  it("generates a video, creates a draft asset, emits a video card", async () => {
    const media = { kind: "video", url: "https://x/v.mp4", source: "ai_generated", model: "veo" };
    const { cards, apiPost, call } = setupVideo([
      async () => ({ operationName: "op/1", model: "veo-2.0-generate-001" }), // start
      async () => ({ status: "running" }), // poll 1
      async () => ({ status: "done", media, objectPath: "arc-generated/v.mp4" }), // poll 2
      async () => ({ campaignId: "c1", assetId: "a1" }), // draft-asset
    ]);
    const p = call({
      prompt: "flood cleanup b-roll",
      title: "Clip",
      name: "X",
      persona: "persona_landlord",
      restoration_focus: "water",
    });
    await vi.runAllTimersAsync();
    const out = await p;

    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/arc/media/generate-video",
      expect.objectContaining({ prompt: expect.stringContaining("flood cleanup b-roll") }),
    );
    expect(apiPost).toHaveBeenNthCalledWith(
      4,
      "/api/v1/arc/campaigns/draft-asset",
      expect.objectContaining({
        media_url: "https://x/v.mp4",
        media_path: "arc-generated/v.mp4",
        asset_type: "video_prompt",
        title: "Clip",
      }),
    );
    expect(cards[0]).toMatchObject({
      kind: "draft",
      media: { kind: "video", format: "16:9" },
      approval: { kind: "campaign", campaignId: "c1", assetId: "a1" },
    });
    expect(out.content[0].text).toContain("a1");
  });

  it("times out and emits no card when Veo never finishes", async () => {
    const posts: Array<() => Promise<unknown>> = [
      async () => ({ operationName: "op/1", model: "veo" }), // start
    ];
    for (let i = 0; i < 36; i++) posts.push(async () => ({ status: "running" })); // every poll still running
    const { cards, call } = setupVideo(posts);
    const p = call({ prompt: "x", title: "T", campaign_id: "c1" });
    await vi.runAllTimersAsync();
    const out = await p;

    expect(cards).toHaveLength(0);
    expect(out.content[0].text).toContain("timed out");
  });

  it("emits no card when start fails", async () => {
    const { cards, call } = setupVideo([
      async () => {
        throw new Error("quota");
      },
    ]);
    const p = call({ prompt: "x", title: "T", campaign_id: "c1" });
    await vi.runAllTimersAsync();
    const out = await p;
    expect(cards).toHaveLength(0);
    expect(out.content[0].text).toContain("failed");
  });

  it("forwards the turn's level on the start POST when ctx provides it", async () => {
    const apiPost = vi.fn(async () => ({ operationName: "op/1", model: "veo" }));
    const client = { apiPost } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const [, genVideo] = mediaTools(client, step, () => {}, { level: "standard" });
    const handler = genVideo.handler as (
      a: Record<string, unknown>,
      e?: unknown,
    ) => Promise<{ content: Array<{ type: string; text: string }> }>;
    // Times out (only the start resolves), but the start body is all we assert.
    const p = handler({ prompt: "x", title: "T", campaign_id: "c1" });
    await vi.runAllTimersAsync();
    await p;
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/arc/media/generate-video",
      expect.objectContaining({ level: "standard" }),
    );
  });
});
