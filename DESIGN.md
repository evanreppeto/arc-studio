# Design System: Signal (Big Shoulders Growth Engine)

## 1. Visual Theme & Atmosphere

A warm, minimal operations command center: deep obsidian surfaces, an antique gold accent, and dense-but-readable operating modules. Surfaces step up in lightness (canvas → panel → inset → raised) so modules visibly lift off the background. Executive and field-aware, instrument-like — not developer-first, not a neon dashboard.

Tokens live in `src/app/globals.css` (`:root`). There is **no `theme.ts`** and no React class-map module — the signed-in app's visual contract is **CSS**: `src/app/(app)/arc-app.css`, every rule scoped under `.arc-app` so it can't leak, plus per-route sheets (`arc/arc.css`, `settings/settings.css`, `studio/studio.css`, `brand/brand.css`, `library/library.css`, `support/support.css`, `campaigns/[campaignId]/campaign.css`, `crm/[objectKey]/[recordId]/record.css`). Pages compose short semantic class names (`card`, `btn gold`, `pill`, `mlabel`) under a per-route root class (`.arc-opps`, `.arc-campaigns`, …). Tailwind v4 is installed via PostCSS but the app screens are not built from utility classes — follow the CSS vocabulary already in the sheet you're editing rather than hard-coding new hex values or inventing a parallel class recipe.

## Palette — Obsidian & Gold

The app uses a warm, minimalist black-and-gold system (token values live in
`src/app/globals.css` `:root`).

- **Canvas:** warm near-black — `--canvas` `#16161a`, deepest `--canvas-deep` `#101013`.
- **Surfaces:** step up `--surface-soft` `#1a1a1e` → `--surface-panel` `#1c1c21` → `--surface-inset` `#202027` → `--surface-raised` `#23232a`.
- **Text:** warm ivory `--text-primary` `#f1ede2`, secondary `#b9b9c0`, muted `#86868e`.
- **Accent:** antique gold `--accent` `#c8a24a` (ink-on-gold via `--on-accent` `#16161a`).
- **Status:** live/ok green `--ok` `#7fb89a`; "needs you"/warn gold `--warn` `#d8b65e`; destructive only red `--priority` `#cc6666`.
- **Headlines:** serif (`--font-serif`, Fraunces) for page titles and Arc's voice; grotesk (`--font-display`) for metrics/labels; body `--font-sans`.

Rules that carry over: **no emojis, no equal 3-column dashboard rows, no neon/purple "AI" aesthetic.** Premium, calm, low-fatigue.

## 3. Typography

Loaded via `next/font` in `src/app/layout.tsx`; exposed as Tailwind families.

- **Editorial serif:** Fraunces (`--ff-serif`, aliased to `--ff-editorial` in `layout.tsx`; `font-optical-sizing: auto`) — the signature. Use for **display moments only**: page-title heroes, the Today greeting, persona/record hero names, auth headlines. Fraunces is loaded at **weights 400, 500, 600** (normal + italic). Hero titles render at 600 (the global `h1,h2,h3` rule, which is unlayered and beats Tailwind weight utilities); body-editorial moments use 400/500. **Never 700+** — Fraunces isn't loaded there and would faux-bold. This is what makes the app read as "authored journal," not "AI dashboard."
- **Display + Body:** Geist (`font-display`/`--ff-display`, `font-sans`/`--ff-body`) — one modern product grotesk (Linear/Vercel-grade) carries headings, labels, body, and metrics so the workhorse UI reads as a single intentional system. Body copy ~65–74ch max. Reserve 600 for hero metrics/titles (see §7).
- **Mono:** Geist Mono (`font-mono`, `--ff-mono`) — identifiers, scores, timestamps. Numbers use `tabular-nums`.
- **Banned:** Inter, system-default-only stacks, gradient text, monospace as lazy "tech" shorthand, **uppercase letter-spaced kicker/eyebrow labels above titles** (a top AI-slop tell — page headers render title-first).

## 4. Component Stylings

These are **CSS classes in `arc-app.css`**, not React components. Reuse the class; don't invent a parallel one.

- **Card** (`.card`): the primary grouping primitive — panel surface, hairline border, soft radius. Don't nest cards.
- **Button** (`.btn`, `.btn.gold`, `.btn.ghost`): the canonical button. Default/`gold` is the solid antique-gold gradient fill with near-black ink (`#1a1505`); `ghost` is transparent with a `--line-2` hairline and `--text-2` label. 34–36px tall, 8–9px radius, 600 weight, `translateY(-1px)` on hover. Use `.btn` on `<button>` and on `<Link>` alike. Never hand-roll button styling or wash a CTA into a faint tint.
- **Pill** (`.pill`) and **Chip** (`.chip`): status and metadata cues — tinted bg + matching border, bright readable text. `.pill` is the status treatment, `.chip` the compact tag/filter.
- **Tables** (`.tablewrap` + `.tabbar` for section switchers): tabular surfaces are composed per route inside a `.tablewrap` scroll container. There is no config-driven `DataTable` component — match the thead/row rhythm of the nearest existing table.
- **Empty states** (`.empty`, `.emptyrow`, `.es`, `.empty-note`): composed and instructive on a soft surface, not a bare "No data".
- **Icons:** inline SVG in `currentColor` — 24 viewBox, ~1.75 stroke, rendered ~20px. The nav rail's icons are defined inline in `app-shell.tsx`; there is no shared `nav-icons.tsx`. `lucide-react` is installed and used **only** by the Arc chat components (`(app)/arc/_components/`) — don't spread it into other routes without a deliberate call. Never raster/PNG icons, no filled or gradient icon styles.
- **On-fill tokens:** `--on-accent` / `--on-priority` are the only correct text colors on solid accent/priority fills (contrast-verified). `--priority-solid` is the button-fill red; `--priority` stays for tints/dots/text.
- **Inputs** (`.mfield`, `.mlabel`): label above, helper/error below, inset surface, 44px min touch target.
- **Shared React components** are few and live in `src/app/(app)/_components/`: `Modal`, `KpiStrip`, `Sparkline`, `ShareDialog`, `CommandPalette`, `ComingSoonToasts`. Everything else is route-local under `<route>/_components/`.
- **Not in this codebase** (removed from this doc after an audit — don't reach for them): `theme.ts`, `PageHeader`, `Panel`, `Button`/`buttonClasses`, `StatusPill`/`ThemeTone`, `DataTable`, `TabNav`, `BackLink`, `CountUp`, `EvidenceChip`, `InlineApprovalCard`, `nav-icons.tsx`, and the `/mark` route (the operator↔agent chat surface is `/arc`). The `.signal-panel` / `.signal-eyebrow` / `.focal-card` classes are still defined in `globals.css` but no component uses them.

## 4.1 Component Library Ownership

The installed libraries support the Signal system; they do not replace it.

Several of these are installed but **not yet used anywhere in `src/`** — the note says where each actually stands today, so nobody assumes an established pattern that doesn't exist.

- **The CSS vocabulary owns the app.** `arc-app.css` + the per-route sheets are the visual contract (see §1 and §4). New surfaces should extend that vocabulary before introducing a library-flavored recipe.
- **cmdk owns command/search patterns** — in use, by `command-palette.tsx`. Keep keyboard-first flows on it.
- **Motion owns state feedback, not spectacle.** In use on the landing page (`landing/_components/`) and the Arc chat. Keep transitions short, reduced-motion safe, and tied to state changes; the calm rules in §6 still bind the workflow screens.
- **Charts are hand-built inline SVG.** Analytics and the Brain knowledge graph both draw their own SVG — that is the pattern. Recharts is **not installed** (§6 bans it). `@mui/x-charts` and `cytoscape` are in `package.json` but imported by nothing (cytoscape only has type shims in `src/types/`); adopting either is a new decision, not a continuation.
- **Radix, MUI, dnd-kit, Rive: installed, zero imports.** If you reach for one, you are establishing the pattern, so do it deliberately: Radix for accessible menus/popovers/collapsibles/dialogs rather than hand-rolled focus trapping; MUI Joy/Material only for dense product controls, always wrapped and mapped to CSS variables, never raw in a page; dnd-kit for board/sortable workflows; Rive and shader effects as brand moments only, never ambient decoration on ordinary workflow screens.

## 4.2 Vocabulary — the words the product uses

Canonical source: **`src/domain/vocabulary.ts`**. Import `WORK_STATE_LABEL` / `toWorkState` / `countOf` — never spell a status label into a component.

This exists because the approval state had **eleven** names at once (BSR-656): *packages waiting, Waiting on you, to decide, Needs you, Needs approval, In review, need review, Ready for review, Awaiting your confirm, Awaiting review, proposed*. `/arc` rendered "Ready for review" and "Needs review" on the same card.

**States.** One string per state, everywhere — board, tab, pill, KPI tile, chat card:

| State | Label | Means |
|---|---|---|
| `draft` | Draft | Arc is still building this. |
| `needs_you` | **Needs you** | Arc finished it and is waiting for your decision. |
| `needs_changes` | Needs changes | You asked for changes. Arc is reworking it. |
| `approved` | Approved | You said yes. It has not gone out yet. |
| `scheduled` | Scheduled | Approved and queued to go out at a set time. |
| `sending` | Sending | Going out to customers now. (Replaces the old split between "Live" and "Sending".) |
| `sent` | Sent | Already delivered. |
| `declined` | Declined | You said no. Nothing will go out. |
| `archived` | Archived | Put away. Nothing will go out. |

Tone: gold = `needs_you` / `needs_changes` (the one accent per screen), green = approved through sent, neutral = the rest. **Red never appears in this table** — it is for destructive controls only. A compliance hold keeps red as an exception and is worded "Blocked by a rule".

**Nouns.** A **campaign** contains **assets** (the email, the SMS, the ad, the landing copy, the image). "Package", "piece", and "deliverable" are retired as user-facing words.

**Never in customer copy:** vendor names (Resend, Gemini, Higgsfield in body text), architecture terms (`layer`, `scoped`, `gated`, `metered`, `runner`, `node`, `token`), database identifiers, or billing-system vocabulary. An empty metric says what the user would have to do to fill it — "Starts once you send your first campaign" — never which input is missing.

## 4.3 The KPI strip

`src/app/(app)/_components/kpi-strip.tsx` is the only KPI row. Import `KpiStrip`; do not hand-roll another grid.

It exists because there were **seven** — `.metrics`, `.okpis`, `.kpis`, `.asum`, `.pstats`, `.bstats`, `.jr-kpis` — six of them an equal `repeat(N, 1fr)` row, which §5 below bans in bold, while the shared component built for the job was used by CRM alone (BSR-658).

**Cell anatomy, in order:** label → value + delta → sparkline → sublabel. Every strip, every screen. The slots are `label`, `value`, `delta`, `sublabel`, `spark`, `tone`, `emptyHint`.

- **Asymmetric by default.** The first metric is the lead and takes ~1.5× the width. That is the reason equal rows are banned: an equal row claims every number matters the same, which is never true.
- **Four cells is the intent, five the ceiling.**
- **The sublabel carries the period.** A delta with no baseline is decoration — prefer "vs previous 30 days" over "580 prev".
- **An empty metric uses `emptyHint`**, and it says what the *user* must do ("Starts once you send your first campaign"), never which input our pipeline lacks.
- **Tone is gold (needs you) or green (healthy). Never red** — a KPI is a fact, not a destructive control.

## 5. Layout Principles

Persistent command rail + asymmetric content grids. Avoid repeated equal 3-column rows. Lead each route with the operational task, then supporting guidance, queues, and next actions. Constrain explanatory copy to ~65–74ch.

## 6. Motion & Interaction — "Fluid" level

CSS-only transform/opacity/filter; cheap enough to stay 60fps and low-latency. Everything below is reduced-motion safe (guarded in `globals.css` + the `data-motion=reduced` global).

- **Entrances:** app screens use the `arcRise` keyframe in `arc-app.css` — a short fade + 8px lift, applied per-element with small stagger delays (`.05s`, `.1s`, `.14s`) so a page *assembles* rather than snapping in. The `.module-rise` / `.rise-in` / `.rise-d1`…`.rise-d5` cascade lives in `globals.css` and is used by the **landing page only**; don't reach for it inside `(app)`.
- **Numbers:** `tabular-nums`, no count-up animation (the `CountUp` component this doc once named does not exist).
- **Data:** charts may self-draw (stroke-dashoffset) where real data exists; build as inline SVG — as Analytics and the Brain graph already do. Recharts is banned and not installed.
- **Hover:** background/border step on lists; arrow nudge + a small `padding-left` slide on actionable rows. `.btn` is the one element that lifts (`translateY(-1px)`); ordinary cards and selected states obey **no levitation** and **no glow**. (`.focal-card` in `globals.css` once carried an accent-bloom exception — nothing uses it now.)
- **Press:** `active:translate-y-px`. **Live:** the pulsing dot is the `arcBreathe` keyframe (`.indtag i`, `.arcnote i`); at most one per view.
- **No** animating layout dimensions, **no** bounce/elastic easing.

## 7. Typographic Weight Discipline

Reserve 700 (bold) for page titles and hero metrics only. UI labels, pills, table headers, and uppercase microlabels stay at 500–600. Never use 800/900 (`font-extrabold`/`font-black`) — heavy weights at small sizes read loud, not authoritative. Inputs and back-links are 500.

## 8. Anti-Patterns

No emojis, no pure black, no purple/neon AI palette, no gradient text, no side-stripe (`border-left`/`right` > 1px) accent borders on cards/lists/callouts, no nested cards, no equal 3-column dashboard rows, no fake round metrics or placeholder names, no glassmorphism-everywhere, no developer jargon in primary UI. No rendered raster/clip-art iconography — icons are monochrome and take their colour from the theme, never from the asset (inline SVG, or a PNG used purely as a CSS mask; see §4). No decorative background imagery behind page headers or panels. No neon glow shadows, no pulsing/radar/ripple ambience. No multi-hue gradient strips as decoration.

## Redesign — Calm Principles (every page must follow)

The foundation pass removed ambient decoration (particle field, hero auras, rail
glow, focal-card bloom). Every redesigned page inherits these rules:

- Lead with the operational task; exactly **one focal moment** per screen.
- Whitespace and hairlines over cards-in-cards; **no nested panels**.
- **No equal 3-column dashboard rows**; use asymmetric grids.
- **One accent use** per screen (the primary/focal cue); one serif (Fraunces)
  display moment (the page title).
- **Calm motion only:** short fades; no levitation (`hover:-translate-y-*`) or
  glow on ordinary elements; at most one live `.status-breathe` dot per view.
- `/arc` is the deliberate rich exception — these rules don't bind it.
