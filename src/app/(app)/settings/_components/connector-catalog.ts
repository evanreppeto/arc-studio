/**
 * The integration catalog behind Settings → Connections → Roadmap: things Arc
 * intends to support, listed honestly as not-yet-built.
 *
 * It lives in its own module so it can be tested against the real connector
 * registry. It used to be a literal inside settings-view.tsx, filtered by two
 * hardcoded display names — which is how Resend, Slack, HubSpot, Mailchimp and
 * Webhooks all ended up advertised as "Planned" while shipped and working one
 * tab away. `liveKey` now ties each row to the connector it becomes, and
 * `connector-catalog.test.ts` fails if one of those keys stops resolving.
 */

export const DCAT: Record<string, string> = { Research: "Grounded web research + citations.", Creative: "Generate & round-trip creative assets.", "Email & SMS": "Sync lists and deliver approved campaigns.", Social: "Schedule approved posts, pull engagement signals.", "CRM & Sales": "Two-way sync of contacts, companies, and deals.", Analytics: "Pull performance back into the learning loop.", Productivity: "Route approvals, files, and alerts." };
/**
 * `liveKey` is the connector key this catalog row corresponds to once it is
 * actually built. The Roadmap tab hides any row whose liveKey is present in the
 * workspace's real connector list, so a connector that ships drops off the
 * roadmap by itself. The previous `live?: number` flag had to be remembered by
 * hand and wasn't: Slack, HubSpot, Mailchimp and Webhooks all shipped and all
 * kept advertising themselves as "Planned".
 */
export type Conn = { n: string; cat: string; c: string; l: string; d?: string; liveKey?: string; note?: string; auth?: string };
export const CONNECTORS: Conn[] = [
  { n: "Gemini Web Research", cat: "Research", c: "#88b6d8", l: "Gem", d: "Grounded web search + citations for scouting & brand research.", liveKey: "gemini-research", note: "read-only" },
  { n: "Higgsfield", cat: "Creative", c: "#c8a24a", l: "Hf", d: "Cinematic image + video, UGC, virality scoring. Drafts only.", liveKey: "higgsfield", note: "Ultra" },
  { n: "Resend", cat: "Email & SMS", c: "#9aa0ac", l: "Re", d: "Transactional + campaign email delivery.", liveKey: "resend", note: "email" },
  { n: "Instagram", cat: "Social", c: "#E1306C", l: "Ig", auth: "oauth" }, { n: "Facebook", cat: "Social", c: "#1877F2", l: "Fb", auth: "oauth" },
  { n: "LinkedIn", cat: "Social", c: "#0A66C2", l: "Li", auth: "oauth" }, { n: "X (Twitter)", cat: "Social", c: "#aab2bd", l: "X", auth: "oauth" },
  { n: "TikTok", cat: "Social", c: "#9cc1e0", l: "Tk", auth: "oauth" }, { n: "YouTube", cat: "Social", c: "#FF5252", l: "Yt", auth: "oauth" },
  { n: "Pinterest", cat: "Social", c: "#E60023", l: "Pin", auth: "oauth" }, { n: "Threads", cat: "Social", c: "#c9ccd1", l: "Th", auth: "oauth" },
  { n: "Mailchimp", cat: "Email & SMS", c: "#f3c64a", l: "Mc", liveKey: "mailchimp-import", auth: "api key" }, { n: "Klaviyo", cat: "Email & SMS", c: "#7fb89a", l: "Kl", auth: "api key" },
  { n: "Twilio", cat: "Email & SMS", c: "#F22F46", l: "Tw", d: "SMS delivery for approved campaigns.", auth: "api key" }, { n: "Customer.io", cat: "Email & SMS", c: "#9678c8", l: "Cio", auth: "api key" },
  { n: "HubSpot", cat: "CRM & Sales", c: "#FF7A59", l: "Hs", liveKey: "hubspot-import", auth: "oauth" }, { n: "Salesforce", cat: "CRM & Sales", c: "#36b3e8", l: "Sf", auth: "oauth" },
  { n: "Pipedrive", cat: "CRM & Sales", c: "#7fb89a", l: "Pd", auth: "oauth" }, { n: "Attio", cat: "CRM & Sales", c: "#88b6d8", l: "At", auth: "oauth" },
  { n: "Google Analytics", cat: "Analytics", c: "#E37400", l: "GA", auth: "oauth" }, { n: "Segment", cat: "Analytics", c: "#52BD94", l: "Sg", auth: "api key" },
  { n: "Amplitude", cat: "Analytics", c: "#5b8def", l: "Am", auth: "api key" }, { n: "Meta Pixel", cat: "Analytics", c: "#1877F2", l: "Mp", auth: "oauth" },
  { n: "Canva", cat: "Creative", c: "#19c4cc", l: "Cv", auth: "oauth" }, { n: "Figma", cat: "Creative", c: "#F24E1E", l: "Fg", auth: "oauth" },
  { n: "Midjourney", cat: "Creative", c: "#c9ccd1", l: "Mj", d: "Import generated art into the Library.", auth: "import" },
  { n: "Slack", cat: "Productivity", c: "#c089cf", l: "Sl", d: "Route approvals + alerts to a channel.", liveKey: "slack-alerts", auth: "oauth" }, { n: "Notion", cat: "Productivity", c: "#d6d6d6", l: "No", auth: "oauth" },
  { n: "Google Drive", cat: "Productivity", c: "#1FA463", l: "Dr", auth: "oauth" }, { n: "Zapier", cat: "Productivity", c: "#FF6A3D", l: "Zp", d: "Trigger 6,000+ apps from Arc events.", auth: "api key" },
  { n: "Webhooks", cat: "Productivity", c: "#9aa0ac", l: "Wh", d: "Post Arc events to any endpoint.", liveKey: "webhook-dispatch", auth: "secret" },
];
export const CATS = ["All", "Social", "Email & SMS", "CRM & Sales", "Analytics", "Creative", "Productivity"];
