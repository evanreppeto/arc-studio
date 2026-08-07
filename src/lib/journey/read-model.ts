import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import {
  assembleJourney,
  ATTRIBUTION_MODELS,
  computeAttribution,
  summarizeFunnel,
  TOUCH_KINDS,
  type AttributionModel,
  type FunnelStage,
  type Journey,
  type JourneyIdentity,
  type JourneyTouch,
  type TouchDirection,
} from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

/**
 * Journeys read-model — assembles each contact's ordered customer journey from
 * data the app *already* records, with no new tracking:
 *
 *   • engagement_events  → outbound sends + inbound engagement (the touch log #440 writes)
 *   • leads              → the identification moment + captured attribution (campaign/channel)
 *   • jobs               → active consideration (booked / in-progress work)
 *   • outcomes (won/paid)→ the conversion + realized revenue
 *
 * All rows are contact-anchored (a "journey" is one known person's path), so
 * rows without a contact_id are skipped in P0. The anonymous pre-lead half of
 * the ladder (Reached/Engaged before identification) lights up in P1 when the
 * collector endpoint + identity stitch land — the model already supports it.
 *
 * Tenancy mirrors performance/read-model: the service-role client bypasses RLS,
 * so every query is org-scoped in app code. Demo data renders only when
 * ARC_DEMO_DATA=1 and there is no live data.
 */

export const DEFAULT_ATTRIBUTION_MODEL: AttributionModel = "last_touch";

export type JourneyWithMeta = Journey & { persona: string | null };

export type JourneyKpis = {
  total: number;
  identified: number;
  /** Identified but not yet converted — the live pipeline Arc can act on. */
  inFlight: number;
  converted: number;
  conversionRate: number;
  realizedCents: number;
  avgDaysToConvert: number | null;
};

export type JourneyChannelCredit = { channel: string; valueCents: number; conversions: number };

/** Per-channel credit under every attribution lens, keyed by model. */
export type ChannelCreditByModel = Record<AttributionModel, JourneyChannelCredit[]>;

export type JourneysReadModel =
  | {
      status: "live";
      isDemo?: boolean;
      funnel: FunnelStage[];
      kpis: JourneyKpis;
      journeys: JourneyWithMeta[];
      /**
       * Conversion value credited per channel, computed for ALL five attribution
       * lenses up front. It's cheap pure math over the same converted journeys, and
       * doing it server-side keeps every lens accurate across the full set — the
       * returned `journeys` list is capped at MAX_JOURNEYS, so recomputing lenses
       * client-side from it would silently under-count.
       */
      channelCreditByModel: ChannelCreditByModel;
      defaultModel: AttributionModel;
      /**
       * Sources whose read hit MAX_ROWS, in operator words. Non-empty means every
       * number above is computed over a PARTIAL set — see the constant's note.
       */
      partialSources?: readonly string[];
    }
  | { status: "unavailable"; message: string };

/**
 * Per-source row ceiling. Unlike MAX_JOURNEYS below — which only trims the
 * rendered list and is restated in the UI — this one truncates the input the
 * funnel, the KPIs and every attribution lens are computed FROM. A workspace
 * over the ceiling gets journeys missing touches: wrong current stage, wrong
 * first touch, and revenue credited to the wrong channel, all stated with the
 * same confidence as a complete read.
 *
 * So the two things this file already does for a failed read, it now does for a
 * partial one: keep it deterministic (every query is ordered newest-first, so
 * truncation drops the oldest rather than an arbitrary thousand) and say so
 * (`partialSources`). Raising the ceiling is not the fix — some workspace is
 * always over it. `engagement_events` is the one to watch: it grows per send,
 * not per customer.
 */
const MAX_ROWS = 1000;
const MAX_JOURNEYS = 60;
// The real `outcome_status` enum is: pending | won | lost | paid | written_off.
// (performance/read-model.ts also filters a "closed_won" that the enum has never
// had — harmless there since the match runs in JS, but don't copy it here.)
const WON_STATUSES = ["won", "paid"];

type ContactRow = { id: string; full_name: string | null; email: string | null; persona: string | null; created_at: string | null };
type EngagementRow = {
  id: string;
  contact_id: string | null;
  campaign_id: string | null;
  campaign_asset_id: string | null;
  event_type: string | null;
  channel: string | null;
  direction: string | null;
  occurred_at: string | null;
  summary: string | null;
};
type LeadRow = {
  id: string;
  contact_id: string | null;
  attributed_campaign_id: string | null;
  attributed_asset_id: string | null;
  attribution_channel: string | null;
  source: string | null;
  received_at: string | null;
  created_at: string | null;
};
type JobRow = { id: string; contact_id: string | null; status: string | null; scheduled_at: string | null; created_at: string | null };
type OutcomeRow = {
  id: string;
  contact_id: string | null;
  status: string | null;
  gross_revenue_cents: number | null;
  closed_at: string | null;
  created_at: string | null;
};
type IdentityRow = { id: string; contact_id: string | null; resolution: string | null; anonymous_id: string | null };
type TouchpointRow = {
  id: string;
  identity_id: string;
  contact_id: string | null;
  occurred_at: string | null;
  kind: string;
  direction: string | null;
  channel: string | null;
  campaign_id: string | null;
  campaign_asset_id: string | null;
  summary: string | null;
  is_conversion: boolean | null;
  value_cents: number | null;
};

/** App-specific engagement_events.event_type → generic touch kind + direction. */
function mapEngagement(row: EngagementRow): { kind: string; direction: TouchDirection } | null {
  const dir = (row.direction ?? "").toLowerCase();
  // Operational/agent events are not part of the *customer's* journey.
  if (dir === "internal") return null;
  const type = (row.event_type ?? "").toLowerCase();

  if (type === "lead_received") return { kind: TOUCH_KINDS.LeadCreated, direction: "inbound" };
  if (type.includes("reply")) return { kind: TOUCH_KINDS.ReplyReceived, direction: "inbound" };
  if (type.includes("open")) return { kind: TOUCH_KINDS.EmailOpen, direction: "inbound" };
  if (type.includes("click")) return { kind: TOUCH_KINDS.EmailClick, direction: "inbound" };
  if (type.includes("visit") || type.includes("landing")) return { kind: TOUCH_KINDS.SiteVisit, direction: "inbound" };
  if (type === "outbound_send" || type.startsWith("dispatch")) {
    const ch = (row.channel ?? "").toLowerCase();
    return { kind: ch.includes("sms") ? TOUCH_KINDS.SmsSent : TOUCH_KINDS.EmailSent, direction: "outbound" };
  }
  // Fall back on the recorded direction; unknown inbound → engaged, outbound → reached.
  if (dir === "outbound") return { kind: TOUCH_KINDS.EmailSent, direction: "outbound" };
  if (dir === "inbound") return { kind: row.event_type ?? "inbound_event", direction: "inbound" };
  return null;
}

export async function getJourneysReadModel(client?: SupabaseClient, orgId?: string, nowMs: number = Date.now()): Promise<JourneysReadModel> {
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled() ? buildDemoJourneys(nowMs) : { status: "unavailable", message: "Journey data is unavailable." };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const resolvedOrgId = orgId ?? (client ? undefined : await getCurrentOrgId());
    const byOrg = <B>(builder: B): B =>
      resolvedOrgId ? (builder as unknown as { eq(c: string, v: string): B }).eq("org_id", resolvedOrgId) : builder;

    // Every query is ordered before it is capped. Without an ORDER BY, a LIMIT
    // returns an arbitrary thousand rows, so the same workspace could show a
    // different funnel on each reload. Each column below is NOT NULL, so no
    // nulls-ordering is needed.
    const [contacts, engagement, leads, jobs, outcomes, identities, touchpoints] = await Promise.all([
      byOrg(supabase.from("contacts").select("id,full_name,email,persona,created_at"))
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS),
      byOrg(
        supabase.from("engagement_events").select("id,contact_id,campaign_id,campaign_asset_id,event_type,channel,direction,occurred_at,summary"),
      )
        .order("occurred_at", { ascending: false })
        .limit(MAX_ROWS),
      byOrg(
        supabase.from("leads").select("id,contact_id,attributed_campaign_id,attributed_asset_id,attribution_channel,source,received_at,created_at"),
      )
        .order("received_at", { ascending: false })
        .limit(MAX_ROWS),
      byOrg(supabase.from("jobs").select("id,contact_id,status,scheduled_at,created_at"))
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS),
      byOrg(supabase.from("outcomes").select("id,contact_id,status,gross_revenue_cents,closed_at,created_at"))
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS),
      byOrg(supabase.from("journey_identities").select("id,contact_id,resolution,anonymous_id"))
        .order("last_seen_at", { ascending: false })
        .limit(MAX_ROWS),
      byOrg(
        supabase
          .from("journey_touchpoints")
          .select("id,identity_id,contact_id,occurred_at,kind,direction,channel,campaign_id,campaign_asset_id,summary,is_conversion,value_cents"),
      )
        .order("occurred_at", { ascending: false })
        .limit(MAX_ROWS),
    ]);

    // EVERY one of these is load-bearing for what this page claims (BSR-575).
    //
    // `contacts` was already fatal. The other six inspected their error and threw
    // it away, which is why renaming `journey_touchpoints` produced a normal
    // looking page while renaming `contacts` produced a banner — the same
    // failure, opposite signals.
    //
    // The tolerance this replaces was written for a real reason: the `journey_*`
    // tables did not exist before the P1 migration. That shipped, and all seven
    // tables are present on prod (verified 2026-07-30), so the only thing the
    // tolerance still catches is a genuine failure.
    //
    // /journeys is the attribution surface, which is what makes silence
    // expensive here: with `outcomes` failing, revenue attribution reads zero,
    // and with `engagement_events` failing a customer shows no history at all.
    // Both are confident false statements about a customer, and the performance
    // learning loop downstream consumes them as fact.
    //
    // Every failed source is named, not just the first, so one reload tells an
    // operator the whole story rather than one table at a time.
    const failures = (
      [
        ["contacts", contacts.error],
        ["engagement_events", engagement.error],
        ["leads", leads.error],
        ["jobs", jobs.error],
        ["outcomes", outcomes.error],
        ["journey_identities", identities.error],
        ["journey_touchpoints", touchpoints.error],
      ] as const
    ).filter(([, error]) => error);

    if (failures.length > 0) {
      throw new Error(
        `journey lookup failed: ${failures
          .map(([table, error]) => `${table} (${error?.message ?? "unknown error"})`)
          .join("; ")}`,
      );
    }

    const contactRows = (contacts.data ?? []) as ContactRow[];
    const engagementRows = (engagement.data ?? []) as EngagementRow[];
    const leadRows = (leads.data ?? []) as LeadRow[];
    const jobRows = (jobs.data ?? []) as JobRow[];
    const outcomeRows = (outcomes.data ?? []) as OutcomeRow[];
    const identityRows = (identities.data ?? []) as IdentityRow[];
    const touchpointRows = (touchpoints.data ?? []) as TouchpointRow[];

    // A source that came back exactly full was almost certainly cut short. Named
    // the way the operator thinks about it, not the way the table is spelled.
    const partialSources = (
      [
        ["customers", contactRows],
        ["email and message activity", engagementRows],
        ["leads", leadRows],
        ["jobs", jobRows],
        ["outcomes", outcomeRows],
        ["site visitors", identityRows],
        ["site activity", touchpointRows],
      ] as const
    )
      .filter(([, rows]) => rows.length >= MAX_ROWS)
      .map(([label]) => label);

    // Nothing to show → demo fallback (only when the flag is on), else empty-live.
    if (contactRows.length === 0 && engagementRows.length === 0 && leadRows.length === 0 && touchpointRows.length === 0) {
      if (isDemoDataEnabled()) return buildDemoJourneys(nowMs);
    }

    // Group every touch under its contact.
    const touchesByContact = new Map<string, JourneyTouch[]>();
    const push = (contactId: string | null, touch: JourneyTouch) => {
      if (!contactId) return;
      const list = touchesByContact.get(contactId);
      if (list) list.push(touch);
      else touchesByContact.set(contactId, [touch]);
    };

    for (const row of engagementRows) {
      const mapped = mapEngagement(row);
      if (!mapped) continue;
      push(row.contact_id, {
        id: `eng:${row.id}`,
        occurredAt: row.occurred_at ?? "",
        kind: mapped.kind,
        direction: mapped.direction,
        channel: row.channel,
        campaignId: row.campaign_id,
        assetId: row.campaign_asset_id,
        summary: row.summary,
      });
    }
    for (const row of leadRows) {
      push(row.contact_id, {
        id: `lead:${row.id}`,
        occurredAt: row.received_at ?? row.created_at ?? "",
        kind: TOUCH_KINDS.LeadCreated,
        direction: "inbound",
        channel: row.attribution_channel,
        campaignId: row.attributed_campaign_id,
        assetId: row.attributed_asset_id,
        summary: row.source ? `Lead from ${row.source}` : "Lead created",
      });
    }
    for (const row of jobRows) {
      push(row.contact_id, {
        id: `job:${row.id}`,
        occurredAt: row.scheduled_at ?? row.created_at ?? "",
        kind: TOUCH_KINDS.JobOpened,
        direction: "system",
        summary: row.status ? `Job ${row.status}` : "Job opened",
      });
    }
    for (const row of outcomeRows) {
      const won = WON_STATUSES.includes(row.status ?? "");
      if (!won) continue;
      push(row.contact_id, {
        id: `outcome:${row.id}`,
        occurredAt: row.closed_at ?? row.created_at ?? "",
        kind: TOUCH_KINDS.OutcomeWon,
        direction: "inbound",
        isConversion: true,
        valueCents: row.gross_revenue_cents ?? 0,
        summary: "Won / paid",
      });
    }

    // Fold in P1 collected touchpoints. A stitched identity's touches merge onto
    // its contact (and mark that contact stitched); an anonymous identity becomes
    // its own pre-lead journey — this is what lights up the Reached/Engaged half.
    const identityById = new Map(identityRows.map((r) => [r.id, r]));
    const anonTouches = new Map<string, JourneyTouch[]>();
    const stitchedContacts = new Set<string>();
    for (const tp of touchpointRows) {
      const touch: JourneyTouch = {
        id: `tp:${tp.id}`,
        occurredAt: tp.occurred_at ?? "",
        kind: tp.kind,
        direction: (tp.direction as JourneyTouch["direction"]) ?? "inbound",
        channel: tp.channel,
        campaignId: tp.campaign_id,
        assetId: tp.campaign_asset_id,
        summary: tp.summary,
        isConversion: tp.is_conversion ?? false,
        valueCents: tp.value_cents,
      };
      const contactId = tp.contact_id ?? identityById.get(tp.identity_id)?.contact_id ?? null;
      if (contactId) {
        push(contactId, touch);
        stitchedContacts.add(contactId);
      } else {
        const list = anonTouches.get(tp.identity_id);
        if (list) list.push(touch);
        else anonTouches.set(tp.identity_id, [touch]);
      }
    }

    const contactById = new Map(contactRows.map((c) => [c.id, c]));
    const journeys: JourneyWithMeta[] = [];
    for (const [contactId, touches] of touchesByContact) {
      if (touches.length === 0) continue;
      const contact = contactById.get(contactId);
      const identity: JourneyIdentity = {
        id: contactId,
        label: contact?.full_name || contact?.email || "Unknown contact",
        resolution: stitchedContacts.has(contactId) ? "stitched" : "known",
      };
      journeys.push({ ...assembleJourney(identity, touches), persona: contact?.persona ?? null });
    }
    // Still-anonymous identities (never stitched) as their own journeys.
    for (const [identityId, touches] of anonTouches) {
      if (touches.length === 0) continue;
      const identity: JourneyIdentity = { id: `anon:${identityId}`, label: "Anonymous visitor", resolution: "anonymous" };
      journeys.push({ ...assembleJourney(identity, touches), persona: null });
    }

    return buildLiveModel(journeys, nowMs, false, partialSources);
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "journey.getJourneysReadModel", surface: "primary" });
    return { status: "unavailable", message: error instanceof Error ? error.message : "Journey data is unavailable." };
  }
}

/** Shared shaping of assembled journeys → funnel + KPIs + channel credit + sorted list. */
function buildLiveModel(
  journeys: JourneyWithMeta[],
  nowMs: number,
  isDemo: boolean,
  partialSources: readonly string[] = [],
): JourneysReadModel {
  const funnel = summarizeFunnel(journeys);

  const converted = journeys.filter((j) => j.converted);
  const identified = journeys.filter((j) => j.stagesReached.includes("identified"));
  const realizedCents = converted.reduce((s, j) => s + j.conversionValueCents, 0);
  const daysList = converted.map((j) => j.daysToConvert).filter((d): d is number => d !== null);
  const avgDaysToConvert = daysList.length ? Math.round(daysList.reduce((a, b) => a + b, 0) / daysList.length) : null;

  const kpis: JourneyKpis = {
    total: journeys.length,
    identified: identified.length,
    inFlight: identified.filter((j) => !j.converted).length,
    converted: converted.length,
    conversionRate: identified.length > 0 ? converted.length / identified.length : 0,
    realizedCents,
    avgDaysToConvert,
  };

  // Channel credit under EVERY lens — "which channels actually drove revenue", and
  // how that answer changes with how you assign credit. Five cheap pure passes over
  // the same converted set; the picker then switches lenses with no round-trip.
  const channelCreditByModel = Object.fromEntries(
    ATTRIBUTION_MODELS.map((m) => [m.key, creditByChannelFor(converted, m.key, nowMs)]),
  ) as ChannelCreditByModel;

  const sorted = [...journeys]
    .sort((a, b) => (Date.parse(b.lastTouchAt ?? "") || 0) - (Date.parse(a.lastTouchAt ?? "") || 0))
    .slice(0, MAX_JOURNEYS);

  return {
    status: "live",
    isDemo: isDemo || undefined,
    funnel,
    kpis,
    journeys: sorted,
    channelCreditByModel,
    defaultModel: DEFAULT_ATTRIBUTION_MODEL,
    partialSources: partialSources.length > 0 ? partialSources : undefined,
  };
}

/** Roll one lens's per-journey credit up by channel, richest first. Pure. */
function creditByChannelFor(converted: JourneyWithMeta[], model: AttributionModel, nowMs: number): JourneyChannelCredit[] {
  const byChannel = new Map<string, JourneyChannelCredit>();
  for (const journey of converted) {
    for (const row of computeAttribution(journey, model, nowMs)) {
      const channel = row.channel ?? "unattributed";
      const cur = byChannel.get(channel) ?? { channel, valueCents: 0, conversions: 0 };
      cur.valueCents += row.valueCents;
      cur.conversions += row.weight; // fractional credit
      byChannel.set(channel, cur);
    }
  }
  return [...byChannel.values()]
    .map((c) => ({ ...c, conversions: Math.round(c.conversions * 10) / 10 }))
    .sort((a, b) => b.valueCents - a.valueCents);
}

// ---------------------------------------------------------------------------
// Demo dataset — believable synthetic journeys for environments with no
// Supabase (local preview, screenshots, sales demos). Flagged via isDemo.
// Read-only display; nothing here implies an outbound action.
// ---------------------------------------------------------------------------

function buildDemoJourneys(nowMs: number): JourneysReadModel {
  const DAY = 86_400_000;
  const CAMP = {
    storm: "aaaaaaaa-0000-4000-8000-000000000001",
    water: "aaaaaaaa-0000-4000-8000-000000000002",
    mold: "aaaaaaaa-0000-4000-8000-000000000003",
  };
  const iso = (daysAgo: number) => new Date(nowMs - daysAgo * DAY).toISOString();

  const specs: { id: string; label: string; persona: string; touches: JourneyTouch[] }[] = [
    {
      id: "demo-1",
      label: "Dana Whitfield",
      persona: "Active Evaluator",
      touches: [
        { id: "t1", occurredAt: iso(21), kind: TOUCH_KINDS.AdImpression, direction: "outbound", channel: "meta", campaignId: CAMP.water, summary: "Saw Pricing-Intent Fast Track ad" },
        { id: "t2", occurredAt: iso(20), kind: TOUCH_KINDS.AdClick, direction: "inbound", channel: "meta", campaignId: CAMP.water, summary: "Clicked the ad" },
        { id: "t3", occurredAt: iso(20), kind: TOUCH_KINDS.LeadCreated, direction: "inbound", channel: "meta", campaignId: CAMP.water, summary: "Submitted the demo request form" },
        { id: "t4", occurredAt: iso(18), kind: TOUCH_KINDS.JobOpened, direction: "system", summary: "Demo scheduled" },
        { id: "t5", occurredAt: iso(12), kind: TOUCH_KINDS.OutcomeWon, direction: "inbound", isConversion: true, valueCents: 4_820_00, channel: "meta", campaignId: CAMP.water, summary: "Deal closed" },
      ],
    },
    {
      id: "demo-2",
      label: "Priya Raman",
      persona: "Evaluator",
      touches: [
        { id: "t1", occurredAt: iso(9), kind: TOUCH_KINDS.EmailSent, direction: "outbound", channel: "email", campaignId: CAMP.storm, summary: "Quarterly Nurture Refresh email" },
        { id: "t2", occurredAt: iso(8), kind: TOUCH_KINDS.EmailClick, direction: "inbound", channel: "email", campaignId: CAMP.storm, summary: "Clicked through to the offer" },
        { id: "t3", occurredAt: iso(7), kind: TOUCH_KINDS.LeadCreated, direction: "inbound", channel: "email", campaignId: CAMP.storm, summary: "Requested a demo" },
        { id: "t4", occurredAt: iso(3), kind: TOUCH_KINDS.JobOpened, direction: "system", summary: "Demo booked" },
      ],
    },
    {
      id: "demo-3",
      label: "Northgate Property Group",
      persona: "Team admin",
      touches: [
        { id: "t1", occurredAt: iso(30), kind: TOUCH_KINDS.EmailSent, direction: "outbound", channel: "email", campaignId: CAMP.mold, summary: "Enterprise expansion outreach" },
        { id: "t2", occurredAt: iso(27), kind: TOUCH_KINDS.ReplyReceived, direction: "inbound", channel: "email", campaignId: CAMP.mold, summary: "Replied asking for a quote" },
        { id: "t3", occurredAt: iso(25), kind: TOUCH_KINDS.LeadCreated, direction: "inbound", channel: "email", campaignId: CAMP.mold, summary: "Qualified lead" },
        { id: "t4", occurredAt: iso(20), kind: TOUCH_KINDS.JobOpened, direction: "system", summary: "Multi-seat rollout scheduled" },
        { id: "t5", occurredAt: iso(6), kind: TOUCH_KINDS.OutcomeWon, direction: "inbound", isConversion: true, valueCents: 12_400_00, channel: "email", campaignId: CAMP.mold, summary: "Contract signed & paid" },
      ],
    },
    {
      id: "demo-4",
      label: "Marcus Bell",
      persona: "Active Evaluator",
      touches: [
        { id: "t1", occurredAt: iso(5), kind: TOUCH_KINDS.AdImpression, direction: "outbound", channel: "meta", campaignId: CAMP.water, summary: "Saw Stalled-Trial Rescue ad" },
        { id: "t2", occurredAt: iso(5), kind: TOUCH_KINDS.SiteVisit, direction: "inbound", channel: "meta", campaignId: CAMP.water, summary: "Visited the landing page" },
      ],
    },
    {
      id: "demo-5",
      label: "Elena Vasquez",
      persona: "Feature Evaluator",
      touches: [
        { id: "t1", occurredAt: iso(14), kind: TOUCH_KINDS.EmailSent, direction: "outbound", channel: "email", campaignId: CAMP.mold, summary: "Feature Adoption Awareness email" },
        { id: "t2", occurredAt: iso(13), kind: TOUCH_KINDS.EmailOpen, direction: "inbound", channel: "email", campaignId: CAMP.mold, summary: "Opened the email" },
        { id: "t3", occurredAt: iso(11), kind: TOUCH_KINDS.LeadCreated, direction: "inbound", channel: "email", campaignId: CAMP.mold, summary: "Booked a walkthrough" },
      ],
    },
    {
      id: "demo-6",
      label: "Riverside Labs",
      persona: "Team admin",
      touches: [
        { id: "t1", occurredAt: iso(120), kind: TOUCH_KINDS.LeadCreated, direction: "inbound", channel: "referral", summary: "Referred by Larkfield Partners" },
        { id: "t2", occurredAt: iso(110), kind: TOUCH_KINDS.OutcomeWon, direction: "inbound", isConversion: true, valueCents: 6_200_00, channel: "referral", summary: "First deal closed" },
        { id: "t3", occurredAt: iso(20), kind: TOUCH_KINDS.EmailSent, direction: "outbound", channel: "email", campaignId: CAMP.storm, summary: "Seasonal re-engagement" },
        { id: "t4", occurredAt: iso(8), kind: TOUCH_KINDS.OutcomeWon, direction: "inbound", isConversion: true, valueCents: 3_100_00, channel: "email", campaignId: CAMP.storm, summary: "Repeat deal closed" },
      ],
    },
  ];

  const journeys: JourneyWithMeta[] = specs.map((s) => ({
    ...assembleJourney({ id: s.id, label: s.label, resolution: "known" }, s.touches),
    persona: s.persona,
  }));

  const model = buildLiveModel(journeys, nowMs, true);
  return model;
}
