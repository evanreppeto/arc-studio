// How an in-app support request becomes a Linear issue.
//
// Pure domain: label names, priority, title and description. The I/O lives in
// src/lib/support/linear.ts. Split this way so the exact shape of a ticket is
// unit-testable without a Linear API key — the same reason formatSupportEmail
// lives next door in support.ts rather than in notify.ts.
//
// The label NAMES below must exist in the target Linear team (they're resolved
// to ids at call time, and a name that resolves to nothing is dropped rather
// than failing the ticket). See docs/SUPPORT-LINEAR.md.

import {
  supportCategoryLabel,
  supportImpactLabel,
  type NormalizedSupportRequest,
  type SupportCategory,
  type SupportImpact,
} from "./support";

/**
 * The marker label every in-app request carries, whatever its category. This is
 * the one filter that answers "did a human in the product report this, or did we
 * write it ourselves?" — so it goes on the ticket unconditionally.
 */
export const SUPPORT_FEEDBACK_LABEL = "user-feedback";

/**
 * Which product the report came from.
 *
 * One Linear team holds tickets for Arc Studio *and* the BSR Manager App, and
 * both file in-app feedback into it. Without this, a single Slack feed can't
 * tell the two apart — which is exactly what it did. It's a member of the `app`
 * label group, so Linear enforces one app per ticket, and the per-app Slack
 * views filter on it.
 *
 * Deliberately NOT derived from `LINEAR_PROJECT_ID`: an env var that isn't set
 * is the failure this replaces. A ticket that reaches Linear at all carries its
 * origin, whatever the deploy is configured with.
 */
export const SUPPORT_APP_LABEL = "Arc Studio";

/**
 * The second label, saying what KIND of feedback it is. `other` deliberately
 * maps to nothing: a made-up "Other" label carries no triage information, and
 * the marker label already says where it came from.
 */
const CATEGORY_LABEL: Record<SupportCategory, string | null> = {
  bug: "Bug",
  question: "Question",
  feature: "Feature",
  billing: "Billing",
  other: null,
};

/** Linear priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
const IMPACT_PRIORITY: Record<SupportImpact, number> = {
  blocking: 1,
  slowing: 2,
  minor: 4,
};

/** Every label name this module can ever ask for — what the id lookup prefetches. */
export function supportLinearLabelNames(): string[] {
  const names = new Set<string>([SUPPORT_FEEDBACK_LABEL, SUPPORT_APP_LABEL]);
  for (const name of Object.values(CATEGORY_LABEL)) if (name) names.add(name);
  return [...names];
}

export function supportLinearLabels(category: SupportCategory): string[] {
  const specific = CATEGORY_LABEL[category];
  const base = [SUPPORT_FEEDBACK_LABEL, SUPPORT_APP_LABEL];
  return specific ? [...base, specific] : base;
}

export function supportLinearPriority(impact: SupportImpact): number {
  return IMPACT_PRIORITY[impact] ?? 3;
}

export type SupportLinearContext = {
  reference: string;
  request: NormalizedSupportRequest;
  workspaceName: string;
  orgId: string;
  submittedByEmail: string;
  submittedByName: string;
  /** Absolute app origin, when known, so the ticket can deep-link the page. */
  appUrl?: string;
};

export type SupportLinearIssueDraft = {
  title: string;
  description: string;
  labels: string[];
  priority: number;
};

function who(ctx: SupportLinearContext): string {
  if (ctx.submittedByName && ctx.submittedByEmail) return `${ctx.submittedByName} (${ctx.submittedByEmail})`;
  return ctx.submittedByName || ctx.submittedByEmail || "an operator with no email on file";
}

function pageLink(ctx: SupportLinearContext): string {
  const path = ctx.request.pagePath;
  if (!path) return "";
  const origin = ctx.appUrl?.trim().replace(/\/+$/, "");
  return origin ? `[${path}](${origin}${path})` : `\`${path}\``;
}

/**
 * The Linear issue for one support request.
 *
 * Body first (it's the actual report), context table after — a triager reads the
 * complaint, then the environment. The reference code appears verbatim so that
 * searching Linear for a code quoted in an email thread finds the ticket.
 */
export function buildSupportLinearIssue(ctx: SupportLinearContext): SupportLinearIssueDraft {
  const { request } = ctx;

  const facts: [string, string][] = [
    ["Reference", `\`${ctx.reference}\``],
    ["Workspace", ctx.workspaceName || "—"],
    ["From", who(ctx)],
    ["Type", `${supportCategoryLabel(request.category)} · ${supportImpactLabel(request.impact)}`],
    ["Page", pageLink(ctx)],
    ["Build", request.diagnostics.appVersion ? `\`${request.diagnostics.appVersion}\`` : ""],
    ["Viewport", request.diagnostics.viewport ?? ""],
    ["Timezone", request.diagnostics.timezone ?? ""],
    ["Browser", request.diagnostics.userAgent ?? ""],
    ["Org", `\`${ctx.orgId}\``],
  ];

  const table = [
    "| | |",
    "| --- | --- |",
    ...facts.filter(([, value]) => value).map(([key, value]) => `| **${key}** | ${value} |`),
  ].join("\n");

  const description = [
    request.body,
    "---",
    table,
    `_Filed automatically from Arc's in-app Help & support form. Reply to ${ctx.submittedByEmail || "the workspace owner"}._`,
  ].join("\n\n");

  return {
    title: request.subject,
    description,
    labels: supportLinearLabels(request.category),
    priority: supportLinearPriority(request.impact),
  };
}
