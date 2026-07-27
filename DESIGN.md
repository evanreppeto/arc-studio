# Design System: Signal (Big Shoulders Growth Engine)

## 1. Visual Theme & Atmosphere

A warm, minimal operations command center: deep obsidian surfaces, an antique gold accent, and dense-but-readable operating modules. Surfaces step up in lightness (canvas → panel → inset → raised) so modules visibly lift off the background. Executive and field-aware, instrument-like — not developer-first, not a neon dashboard.

Tokens live in `src/app/globals.css` (`:root`) and the reusable React class contract lives in `src/app/_components/theme.ts`. Always build from those sources rather than hard-coding new hex values, one-off tone aliases, or local button/pill class maps.

## Palette — Obsidian & Gold

The app uses a warm, minimalist black-and-gold system (token values live in
`src/app/globals.css` `:root`).

- **Canvas:** warm near-black — `--canvas` `#16161a`, deepest `--canvas-deep` `#101013`.
- **Surfaces:** step up `--surface-soft` `#1a1a1e` → `--surface-panel` `#1c1c21` → `--surface-inset` `#202027` → `--surface-raised` `#23232a`.
- **Text:** warm ivory `--text-primary` `#f1ede2`, secondary `#b9b9c0`, muted `#86868e`.
- **Accent:** antique gold `--accent` `#c8a24a` (ink-on-gold via `--on-accent` `#16161a`).
- **Status:** live/ok green `--ok` `#7fb89a`; "needs you"/warn gold `--warn` `#d8b65e`; destructive only red `--priority` `#cc6666`.
- **Headlines:** serif (`--font-serif`, Fraunces) for page titles and Mark's voice; grotesk (`--font-display`) for metrics/labels; body `--font-sans`.

Rules that carry over: **no emojis, no equal 3-column dashboard rows, no neon/purple "AI" aesthetic.** Premium, calm, low-fatigue.

## 3. Typography

Loaded via `next/font` in `src/app/layout.tsx`; exposed as Tailwind families.

- **Editorial serif:** Fraunces (`font-editorial` / `--ff-editorial`, `font-optical-sizing: auto`) — the signature. Use for **display moments only**: page-title heroes (via `PageHeader`), the Today greeting, persona/record hero names, auth headlines. Fraunces is loaded at **weights 400, 500, 600** (normal + italic). Hero titles render at 600 (the global `h1,h2,h3` rule, which is unlayered and beats Tailwind weight utilities); body-editorial moments use 400/500. **Never 700+** — Fraunces isn't loaded there and would faux-bold. This is what makes the app read as "authored journal," not "AI dashboard."
- **Display + Body:** Geist (`font-display`/`--ff-display`, `font-sans`/`--ff-body`) — one modern product grotesk (Linear/Vercel-grade) carries headings, labels, body, and metrics so the workhorse UI reads as a single intentional system. Body copy ~65–74ch max. Reserve 600 for hero metrics/titles (see §7).
- **Mono:** Geist Mono (`font-mono`, `--ff-mono`) — identifiers, scores, timestamps. Numbers use `tabular-nums` and animate up on first paint via the `CountUp` component (`src/app/_components/count-up.tsx`).
- **Banned:** Inter, system-default-only stacks, gradient text, monospace as lazy "tech" shorthand, **uppercase letter-spaced kicker/eyebrow labels above titles** (a top AI-slop tell — `PageHeader` renders title-first; the `eyebrow` prop is ignored).

## 4. Component Stylings

- **Panel** (`.signal-panel`): 0.75rem radius, 1px `--border-panel`, panel surface + subtle top highlight, `--elev-panel` shadow. The primary grouping primitive — don't nest panels.
- **Eyebrow** (`.signal-eyebrow`): display font, uppercase, 0.2em tracking, accent color; pair with a short accent tick, not a heading restatement.
- **Button** (`Button` / `buttonClasses` in `page-header.tsx`, backed by `theme.ts`): the canonical button. Variants `primary` (solid `--accent`, `--on-accent` text), `priority` (solid `--priority-solid` red, `--on-priority` text — both AA ≥4.5:1), `ghost` (inset + hairline border). Sizes `md` (44px touch target) / `sm`. Use `<Button>` for buttons, `buttonClasses({variant})` on a `<Link>`. Never hand-roll button classes or wash a CTA into a faint tint.
- **DataTable** (`data-table.tsx`): config-driven table (columns with custom `cell` renderers, `isSelected`, `minWidth`, `emptyState`). Centralizes thead, row rhythm, hover/selected states, and `scope="col"`. Use for any tabular data.
- **Tabs** (`TabNav` in `tab-nav.tsx`, backed by `control.tab*` in `theme.ts`): the canonical tabbed-section nav — a card grid of `{key,label,detail?,count?,href}` items with one active treatment (accent border + soft fill). Use it for any in-page section switcher; never hand-roll tab class strings.
- **Icons:** monochrome and driven by `currentColor`, always — that is the rule the rest of this bullet serves. Two sanctioned sources:
  - **Inline SVG line icons** — 24 viewBox, 1.75 stroke, `currentColor`, rendered at ~20px. The default everywhere in the app.
  - **PNG used as a CSS mask** — the sidebar rail (`NavIcon` in `app-shell.tsx` → `.nav-image-icon`). The element paints `currentColor` and the PNG supplies only its alpha shape via `mask: var(--nav-icon)`. The file's own colour is discarded, so a masked icon is still monochrome, still inherits colour, and still warms to `--accent` when its item is active.

  Still banned: **rendered** raster/clip-art iconography (an `<img>` whose baked-in colour is what you see), and filled or gradient icon styles. The distinction that matters is not the file format — it is whether the icon's colour comes from the theme or from the asset.
- **Back-link:** detail/record pages pass `backHref`/`backLabel` to `PageHeader` (renders the shared `BackLink`). Don't hand-roll back buttons.
- **Mark chat** (`src/app/mark/`): the operator↔Mark conversational surface — a full-height workbench panel, no page header above it. Thread rail (search, pinned, projects with progressive `+` creation, archived) + integrated conversation header (renameable title, thread menu, Operations link; on mobile the rail becomes a drawer behind a header toggle). Conversation: operator messages as right-aligned quiet bubbles with hover timestamps; Mark replies flat full-width with avatar + name/time line; day separators; inline action cards (approve/decline/revision) and collapsible step traces. Composer: mode picker (ask/act/draft) with a governance dot, @-mention and /-command popovers, keyboard hints left + "outbound stays locked" right. New-chat state is a work launcher: time-of-day greeting, centered composer, workflow shortcuts with a live pending-approvals count. CSS-only thinking indicators, reduced-motion safe.
- **On-fill tokens:** `--on-accent` / `--on-priority` are the only correct text colors on solid accent/priority fills (contrast-verified). `--priority-solid` is the button-fill red; `--priority` stays for tints/dots/text.
- **Status Pills** (`StatusPill`, backed by `ThemeTone` in `theme.ts`): tinted bg + matching border + colored dot, bright readable text. Tones: amber/green/red/gray/blue/dark.
- **EvidenceChip** (`evidence-chip.tsx`): the source/citation cue — optional `[n]` index, source label, optional confidence %, optional link. Use wherever the UI shows evidence (Opportunities, Home focal card, Arc citations, Brand facts).
- **InlineApprovalCard** (`inline-approval-card.tsx`): the approval-gated draft card — title + draft body + decision slots (gold `Approve` as the single focal action, ghost revise/decline) + an always-on "Outbound stays locked" badge. Use for any in-flow approve/decline (Arc replies, Activity, Campaign builder, Outbox).
- **Inputs:** label above, helper/error below, inset surface, 44px min touch target.
- **Empty states:** composed and instructive, dashed `--border-strong` on soft surface.

## 4.1 Component Library Ownership

The installed libraries support the Signal system; they do not replace it.

- **Signal primitives own the app vocabulary.** `theme.ts`, `PageHeader`, `Button`, `StatusPill`, `Panel`, `DataTable`, and `TabNav` remain the visual contract. New components should compose these before introducing local class recipes.
- **Radix owns behavior primitives.** Use Radix for accessible menus, popovers, collapsibles, dialogs, and other stateful interactions, then skin them with Signal tokens. Do not hand-roll focus trapping, menu keyboard behavior, or disclosure semantics.
- **MUI is opt-in and wrapped.** Use MUI Joy/Material only for complex product controls that materially benefit from its maturity, such as dense forms, selects, settings controls, and future data-management surfaces. Never drop raw MUI styling into pages; wrap it behind Signal-named components and map it to CSS variables.
- **dnd-kit owns drag behavior.** Use it for board and sortable workflows, with restrained motion and explicit state labels.
- **cmdk owns command/search patterns.** Use it for command palette and quick-jump flows where keyboard-first behavior matters.
- **Motion owns state feedback, not spectacle.** Keep transitions short, reduced-motion safe, and tied to state changes.
- **Recharts and Cytoscape own specialized visualization.** Recharts belongs to analytics; Cytoscape belongs to Brain. Both must be token-themed and legible on dark surfaces.
- **Rive and shader effects are brand moments only.** They may support Arc identity or empty states, but they should never become ambient decoration across ordinary workflow screens.

## 5. Layout Principles

Persistent command rail + asymmetric content grids. Avoid repeated equal 3-column rows. Lead each route with the operational task, then supporting guidance, queues, and next actions. Constrain explanatory copy to ~65–74ch.

## 6. Motion & Interaction — "Fluid" level

CSS-only transform/opacity/filter; cheap enough to stay 60fps and low-latency. Everything below is reduced-motion safe (guarded in `globals.css` + the `data-motion=reduced` global).

- **Entrances:** two tiers. `.module-rise` is the at-once page fade (forced to 0 delay). `.rise-in` is the opt-in **staggered blur-rise cascade** (`.rise-d1`…`.rise-d5`) for redesigned surfaces — sequence hero → sections → rail so a page *assembles* rather than snapping in.
- **Numbers:** count up on first paint via `CountUp` (easeOutCubic, ~900–1100ms).
- **Data:** charts may self-draw (stroke-dashoffset) where real data exists; build as inline SVG (recharts is banned here — see project notes).
- **Hover:** background/border step on lists; arrow nudge + a small `padding-left` slide on actionable rows. The **focal card** (`.focal-card`, the single primary action per surface) is the *one* allowed accent-glow-on-hover (its border warms to `--accent-border-strong` + a soft accent bloom) — everywhere else still obeys **no levitation** (`hover:-translate-y-*`) and **no glow on ordinary cards/selected states**.
- **Press:** `active:translate-y-px`. **Live:** at most one `.status-breathe` dot per view.
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
- `/arc` and `/mark` are the deliberate rich exceptions — these rules don't bind them.
