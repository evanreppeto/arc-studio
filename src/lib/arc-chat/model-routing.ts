import type { ArcRoute } from "@/domain";

import { inferArcRunIntent } from "./run-profile";

export type ArcModelPreference = ArcRoute | "auto";

/** Resolve the composer's friendly model choice to the runner's existing route. */
export function resolveArcModelRoute(input: {
  preference: ArcModelPreference;
  request?: string | null;
  command?: string | null;
}): ArcRoute {
  if (input.preference !== "auto") return input.preference;

  const intent = inferArcRunIntent({ request: input.request, command: input.command });
  // Sonnet is the responsive default for chat, research, and analysis. Reserve
  // the slower Opus route for work that creates or changes durable workspace
  // output; operators can still select Forge explicitly for any turn.
  return intent === "create" || intent === "action" ? "standard" : "fast";
}

/**
 * Which media category a turn's model pick applies to.
 *
 * The composer sends one pick per turn, but "which model" is a different answer
 * for a still than for a clip, so the pick has to be attributed to a category
 * before it means anything. The request itself is the only signal available at
 * send time — the same basis `resolveArcModelRoute` already routes on.
 *
 * Image is the default because it is overwhelmingly the common case and the
 * cheap one: mistaking a video request for an image request costs an unused
 * pick (the resolver drops a wrong-category override and auto-picks), whereas
 * defaulting to video would mis-attribute nearly every turn.
 */
const VIDEO_REQUEST = /\b(video|clip|reel|footage|animat(?:e|ed|ion)|b-?roll|motion|film(?:ed|ing)?)\b/i;

export function inferMediaCategory(request?: string | null): "image" | "video" {
  return VIDEO_REQUEST.test(request ?? "") ? "video" : "image";
}
