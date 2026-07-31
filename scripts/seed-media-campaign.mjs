import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function getSupabase() {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function insertOne(supabase, table, values) {
  const { data, error } = await supabase.from(table).insert(values).select("id").single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return data.id;
}

const PERSONA = "persona_property_manager";

// The read-model derives media from a `media_assets` array found in any campaign
// / asset / approval JSON payload. Each item maps url/title/description/type/
// thumbnail_url/mime_type → a typed CampaignMediaAsset. URL extension and `type`
// drive the image/video/embed/file/link classification.
const IMAGES = [
  {
    url: "https://picsum.photos/seed/bsr-hero/1280/800.jpg",
    thumbnail_url: "https://picsum.photos/seed/bsr-hero/440/280.jpg",
    type: "image",
    mime_type: "image/jpeg",
    title: "Hero — restored lobby",
    description: "Generated hero visual: a clean, restored multifamily lobby after water mitigation.",
  },
  {
    url: "https://picsum.photos/seed/bsr-beforeafter/1280/800.jpg",
    thumbnail_url: "https://picsum.photos/seed/bsr-beforeafter/440/280.jpg",
    type: "image",
    mime_type: "image/jpeg",
    title: "Before / after — basement common area",
    description: "Split before/after of a restored basement common area.",
  },
  {
    url: "https://picsum.photos/seed/bsr-postcard/1000/1400.jpg",
    thumbnail_url: "https://picsum.photos/seed/bsr-postcard/360/500.jpg",
    type: "image",
    mime_type: "image/jpeg",
    title: "Direct-mail postcard mockup",
    description: "Portrait postcard mockup for the property-manager mailing.",
  },
  {
    url: "https://picsum.photos/seed/bsr-social/1080/1080.jpg",
    thumbnail_url: "https://picsum.photos/seed/bsr-social/420/420.jpg",
    type: "image",
    mime_type: "image/jpeg",
    title: "Social ad creative (1:1)",
    description: "Square paid-social creative for managed-building partners.",
  },
];

const MOTION = [
  {
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    thumbnail_url: "https://picsum.photos/seed/bsr-video/1280/720.jpg",
    type: "video",
    mime_type: "video/mp4",
    title: "30s testimonial cut",
    description: "Property manager describes a burst-pipe night handled in two hours with full documentation.",
  },
  {
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    type: "video",
    title: "Brand explainer (YouTube)",
    description: "Embedded brand explainer for the vendor-packet landing page.",
  },
];

const DOCS = [
  {
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    type: "file",
    mime_type: "application/pdf",
    title: "Vendor packet (PDF)",
    description: "Services, SLA, and insurance-documentation process for property-manager pre-approval.",
  },
];

const LINKS = [
  {
    url: "https://www.figma.com/file/EXAMPLE/Spring-Launch-Creative",
    type: "link",
    title: "Figma creative board",
    description: "Working board with all Spring Launch creative variants.",
  },
];

const ALL_MEDIA = [...IMAGES, ...MOTION, ...DOCS, ...LINKS];

const ASSETS = [
  { asset_type: "image_prompt", channel: "media", title: "Hero + before/after visuals", draft_body: "Generated hero and before/after restoration visuals for the landing page and social.", media_assets: [IMAGES[0], IMAGES[1]] },
  { asset_type: "social_ad", channel: "meta_ad", title: "Social ad — managed buildings", draft_body: "Protect your North Shore portfolio. Priority response for managed buildings.", media_assets: [IMAGES[3]] },
  { asset_type: "video_prompt", channel: "media", title: "30s testimonial video", draft_body: "30s testimonial: property manager describes a burst-pipe night handled in 2 hours.", media_assets: [MOTION[0]] },
  { asset_type: "one_pager", channel: "doc", title: "Vendor packet one-pager", draft_body: "Services, response SLA, insurance documentation process, references.", media_assets: [DOCS[0]] },
  { asset_type: "email", channel: "email", title: "Partner intro email", draft_body: "Subject: Priority water-loss response for your North Shore properties\n\nHi {{first_name}},\n\nWhen a unit floods, your residents call you first. Request the vendor packet to pre-approve us." },
];

async function seedMediaCampaign() {
  const supabase = getSupabase();
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", "big-shoulders-restoration")
    .single();
  if (orgError || !org) throw new Error("Seed requires the big-shoulders-restoration organization (run the tenancy migration first).");
  const orgId = org.id;

  const companyId = await insertOne(supabase, "companies", {
    name: `North Shore Creative Showcase ${runId}`,
    persona: PERSONA,
    org_id: orgId,
    status: "active",
    metadata: { demo_seed: true, run_id: runId, service_area_zips: ["60091", "60093", "60201"] },
  });

  const contactId = await insertOne(supabase, "contacts", {
    company_id: companyId,
    persona: PERSONA,
    org_id: orgId,
    status: "active",
    first_name: "Dana",
    last_name: "Whitfield",
    email: "dana.whitfield@northshore-pg.local",
    title: "Director of Operations",
    metadata: { demo_seed: true, run_id: runId },
  });

  const leadId = await insertOne(supabase, "leads", {
    company_id: companyId,
    contact_id: contactId,
    persona: PERSONA,
    org_id: orgId,
    status: "qualified",
    source: "seed_media_campaign",
    external_lead_id: `seed-media-campaign-${runId}`,
    lead_score: 86,
    metadata: { demo_seed: true, run_id: runId },
  });

  const campaignId = await insertOne(supabase, "campaigns", {
    name: `Creative Showcase — North Shore Spring Launch ${runId}`,
    org_id: orgId,
    persona: PERSONA,
    restoration_focus: "water_backup",
    status: "pending_approval",
    company_id: companyId,
    contact_id: contactId,
    lead_id: leadId,
    owner: "Arc (Arc)",
    objective: "Review the full creative set — images, video, documents, and links — before approving the Spring Launch.",
    audience_summary: "Property managers and operations directors overseeing multifamily portfolios in 60091/60093/60201.",
    offer_summary: "Documented, insurance-ready water-loss response with a managed-building SLA and a vendor pre-approval packet.",
    compliance_notes: "No outbound send until human approval. Persona-safe CTAs only (Request Vendor Packet / Become a Partner).",
    source_signal: { demo_seed: true, run_id: runId },
    reasoning_payload: {
      demo_seed: true,
      why_arc_created_it: "Spring thaw + aging North Shore plumbing drives water-backup losses; a complete creative set lets the operator approve the whole launch in one review.",
      recommended_action: "Review the image set and testimonial video, approve the email and one-pager; keep paid ads gated pending budget sign-off.",
      tools_used: ["crm_lookup", "evidence_search", "creative_generator", "image_generator", "video_generator"],
      guardrails: ["No outbound send before approval", "No ad spend before budget sign-off"],
      prompt_inputs: { persona: PERSONA, restoration_focus: "water_backup", geo: ["60091", "60093", "60201"] },
      media_assets: ALL_MEDIA,
    },
    audit_payload: { demo_seed: true, run_id: runId, created_by: "seed-media-campaign" },
  });

  const assetIds = [];
  for (const asset of ASSETS) {
    const id = await insertOne(supabase, "campaign_assets", {
    org_id: orgId,
      campaign_id: campaignId,
      asset_type: asset.asset_type,
      channel: asset.channel,
      title: asset.title,
      status: "pending_approval",
      tool_source: "creative_generator",
      draft_body: asset.draft_body,
      dispatch_locked: true,
      reasoning_payload: { demo_seed: true, run_id: runId, ...(asset.media_assets ? { media_assets: asset.media_assets } : {}) },
      audit_payload: { demo_seed: true, run_id: runId },
    });
    assetIds.push(id);
  }

  // One approved + two pending so the decision stepper and Approvals tab populate.
  const emailApprovalId = await insertOne(supabase, "approval_items", {
    org_id: orgId,
    campaign_id: campaignId,
    campaign_asset_id: assetIds[4],
    company_id: companyId,
    contact_id: contactId,
    lead_id: leadId,
    item_type: "email_campaign_asset",
    status: "approved",
    risk_level: "low",
    draft_output: ASSETS[4].draft_body,
    requested_by: "arc",
    reviewed_by: "Evan",
    reviewed_at: new Date().toISOString(),
    reasoning_payload: { demo_seed: true, run_id: runId },
    audit_payload: { demo_seed: true, run_id: runId },
  });

  await insertOne(supabase, "approval_decisions", {
    org_id: orgId,
    approval_item_id: emailApprovalId,
    decision: "approved",
    decided_by: "Evan",
    decision_notes: "Copy is on-brand and persona-safe. Approved; outbound still gated.",
    previous_status: "pending_approval",
    next_status: "approved",
    metadata: { demo_seed: true, run_id: runId, source: "seed-media-campaign", outbound_locked: true },
  });

  await insertOne(supabase, "approval_items", {
    org_id: orgId,
    campaign_id: campaignId,
    campaign_asset_id: assetIds[1],
    company_id: companyId,
    item_type: "paid_social_ad",
    status: "pending_approval",
    risk_level: "high",
    draft_output: ASSETS[1].draft_body,
    requested_by: "arc",
    compliance_notes: "Paid spend — requires budget sign-off before launch.",
    prompt_inputs: { channel: "meta_ad", creative_count: 1, placement: "feed" },
    reasoning_payload: { demo_seed: true, run_id: runId, media_assets: [IMAGES[3]] },
    audit_payload: { demo_seed: true, run_id: runId },
  });

  await insertOne(supabase, "approval_items", {
    org_id: orgId,
    campaign_id: campaignId,
    campaign_asset_id: assetIds[0],
    company_id: companyId,
    item_type: "image_creative_set",
    status: "pending_approval",
    risk_level: "medium",
    draft_output: "Hero and before/after restoration visuals for the landing page and paid social.",
    requested_by: "arc",
    prompt_inputs: { style: "clean, professional, no people", variants: 4 },
    reasoning_payload: { demo_seed: true, run_id: runId, media_assets: [IMAGES[0], IMAGES[1]] },
    audit_payload: { demo_seed: true, run_id: runId },
  });

  return { runId, campaignId, mediaCount: ALL_MEDIA.length, href: `/campaigns/${campaignId}` };
}

seedMediaCampaign()
  .then((result) => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exit(1);
  });
