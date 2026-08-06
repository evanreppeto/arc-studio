# Model Selection — Design (three layers, not one picker)

Status: **built** · Owner: Arc platform · Last updated: 2026-08-06

## Problem

"Let users pick which models they use" sounds like one setting. It's actually
**three independent choices at three altitudes.** Mixing them into a single flat
picker is a UX and conceptual error — it implies `claude-opus-4-8` and `veo3` are
substitutable, which they aren't (one is Arc's brain, the other is a tool the
brain calls). This doc defines the three layers, the selectable options in each,
and the one that still needs wiring.

Guiding principle everywhere: **Auto is the default; selection is an override.**
Arc is an agent — it should pick the right model per task. The human overrides
when they have a reason.

---

## Layer 1 — Backend / connector (which engines are ON)

**What the user chooses:** Is Higgsfield connected? Gemini? With whose credits.
**Status:** ✅ real & persisted — `workspace_connectors` +
`listWorkspaceConnectors` (`src/lib/connectors/read-model.ts`). Binary on/off,
credential-gated per workspace.

| Connector key | Label | Auth | Access | Notes |
|---|---|---|---|---|
| `gemini-research` | Gemini Web Research | api_key | read_only | Grounded web search (native, `mcpUrl: null`) |
| `higgsfield` | Higgsfield | oauth | gated_write | Remote MCP — the media engine (fans out to ~59 models) |

Only change worth making: surface a "credits/cost owner" line so operators know
Higgsfield burns their own credits.

---

## Layer 2 — Media model (which model generates)

**What the user chooses:** per output category, which specific model generates —
across **both** engines, not one. **Status:** ✅ built end to end.

### The bug this layer shipped with, and what fixed it

Until 2026-08-06 this was two disconnected settings over two rosters, and neither
reached the wire:

- `app_settings.image_model` / `video_model` — the **Gemini** roster, read by the
  app-side `generate-*` routes. Settings had a picker for it.
- `workspace_media_config.defaults` — the **Higgsfield** roster, injected into
  Arc's prompt as prose. `saveMediaConfigAction` had **zero callers**; prod
  carried **zero** `workspace_media_config` rows and zero `image_model` rows. The
  44-model roster was unreachable by any operator.

So an operator could lock a model on one engine and watch generation run on the
other, with no error anywhere. Worse, the Higgsfield half arrived as a
suggestion — *"use `veo3_1` unless the task truly needs another model"* — when
`model` is a **required argument** on Higgsfield's `generate_*` tools.

**The fix is one resolution, shared by every surface.**

- **Domain** — `src/domain/media-target.ts`. One roster (`GENERATION_MODELS`)
  spanning both engines, ids namespaced `gemini:` / `higgsfield:` because both
  engines have a "Veo 3.1" and a bare id can't say which is meant.
  `resolveGenerationTarget` takes (category, workspace config, this request's
  pick, engine availability, legacy per-org Gemini default) and returns ONE
  `GenerationTarget`. `src/lib/settings/store.ts` now derives its allow-list from
  this roster instead of re-listing the ids.
- **Precedence** — this request's pick → workspace default → legacy per-org
  Gemini setting → Auto. `autoPick` suppresses **both** stored layers.
- **Enforcement** — `geminiModelForTarget` returns the id to put on the wire, or
  `undefined` for Auto (which leaves Gemini's own `level → env → default` chain
  intact, so Auto is behaviour-identical to before). A Higgsfield target returns
  `undefined` here on purpose: the app cannot execute Higgsfield, so pinning its
  id onto a Gemini call would send a model the API has never heard of.
- **Availability** — `resolveWorkspaceEngines` (`src/lib/media-config/target.ts`).
  A pick on a disconnected engine is ignored, and pickers only offer engines the
  workspace can actually reach.
- **Consumers** — Studio (`studio/actions.ts`), `/api/v1/arc/media/generate-image`,
  `/generate-video`, `/edit`. Each resolves a target and passes its id as a real
  provider argument. The per-request override arrives as `model_key` (NOT `model`
  — the video *poll* request already carries `model`, the started Gemini id, for
  metering).
- **UI** — Settings → Media models is now ONE panel over both engines
  (`saveMediaConfig`, which returns a real result instead of `void`), plus a
  per-request picker in the Studio composer and the Arc composer.
- **Runner** — `GET /api/v1/arc/media-config` still returns resolved per-category
  Higgsfield defaults, but `context.ts` now states them as the **value of the
  required `model` argument**, and a per-turn composer pick outranks the stored
  default. The pick crosses to the runner **already resolved** (`MediaPick`), so
  the runner never interprets a model reference — it relays `key` back to the
  media endpoints, which validate it again.

### Executing Higgsfield app-side

The app now runs Higgsfield generations itself, so a Higgsfield pick is a
parameter on a call we make — not only a required argument named in Arc's prompt.

- **Transport** — `src/lib/connectors/mcp-client.ts`: `initialize` → `tools/call`
  over HTTP, SSE-aware. `checkHiggsfieldToken` was rebuilt on it so the health
  check and real generations cannot drift apart.
- **Contract** — `src/lib/connectors/higgsfield-mcp.ts`. Submits through the
  **headless** `generate_image_batch` / `generate_video_batch` (the plain
  `generate_image` tool exists to render a widget in a chat client), then polls
  `jobs_wait`. `use_unlim: false` is always explicit: omitting it makes the server
  ask a human whether to spend their free-trial allowance, and an unattended
  server action has nobody to ask.
- **Provider** — `src/lib/media/higgsfield.ts`, same `MediaProvider` interface as
  Gemini, so callers stay engine-agnostic.
- **Selection** — `src/lib/media/engine-provider.ts` turns a resolved target into
  the provider that executes it, with the right credential and the right meter.
  The old `gemini-media` gate was removed from Studio and the media routes: it
  refused a workspace whose only connected engine is Higgsfield.

**Contract confidence — a real generation was run on 2026-08-06** (job
`13af5a4f-85db-470d-8b40-1915fe0b6b30`, `nano_banana_pro`, 2 credits). Every
envelope is now recorded from the live server and pinned in the tests. Three
things the run found that no mock could:

1. **It took ~75 seconds** (`pending` → `in_progress` → `completed`). The
   provider waited 40 and would have abandoned every real render. The budget is
   now caller-supplied, defaulting to 50s — which still does not fit every
   model, so **`maxDuration = 60` on the Studio route is the binding
   constraint**, and expiry now names the job id so the paid-for render can be
   found rather than silently lost.
2. **`poll_after_seconds: 10`** rides along with `timed_out: true` on an expired
   long poll. The loop honours the server's cadence instead of a made-up one.
3. **The server substituted the model** — a submit for `nano_banana_pro` reported
   back as `nano_banana_2`. Provenance records what actually ran, not what was
   asked for, or an approval card credits a model that never touched the asset.

**Closed 2026-08-06: images are start-then-poll.** `MediaProvider` gained optional
`startImage` / `pollImage` — optional because the engines genuinely differ, and
pretending otherwise is what broke. Gemini answers inline in a second; Higgsfield
answers with a job. `POST /api/v1/arc/media/generate-image` now mirrors the video
route: `status: "running"` + an operation name on a job-based engine, a poll mode
keyed on `operation_name` (+ the `engine` that started it), and ONE shared
`landImage` tail so the inline and polled paths cannot drift into writing
different Library rows. The runner's `generate_image` tool polls it, same shape
as `generate_video`. A poll is never metered — the render is already paid for,
and billing per "is it done yet" would be charging for the question.

**Studio can now generate a picture from a description** (2026-08-06). It could
previously only composite over media you already owned and edit media you
already owned, so a workspace with no approved photos had nothing to start from
— and `generateStudioAsset({engine: "image"})` sat there with no UI caller while
the "AI" source tab was a note rather than a button.

The control has its own gate (`sceneGate`): it deliberately does NOT require a
background, because sharing compose's gate would refuse the very action that
produces the background compose is missing. The result lands as an
approval-gated draft like every other output, becomes the selected canvas
background (the next thing anyone wants is to compose over what they just made),
and appears in the "AI" source tab. It is a job on a job-based engine, same
start-then-poll as everything else.

Risk flags differ by path and that is load-bearing: an edit carries
`EDITED_RISK` because it inherits whatever its source was proof of; a generation
has no source to inherit from, so carrying it would misdescribe the asset.

### Reference media — edits and photo-to-video (2026-08-06)

Higgsfield generators take a `media_id` and **reject an `https://` URL in
`medias[].value`**, which is why editing and start-frames were impossible.
`importHiggsfieldMedia` (`media_import_url`, VERIFIED → `{media_id, type,
content_type, source_url}`) mints one from a public URL in a single call —
better than `media_upload`'s presign → PUT → confirm, since every caller already
holds a permanent public campaign-media URL.

`ImageGenInput.source` / `ImageEditInput.sourceUrl` / `VideoGenInput.image.url`
carry the picture as a **URL alongside the bytes**, because the engines want
opposite things: Gemini takes bytes inline, Higgsfield takes a media_id it mints
itself.

**Roles are per-model and not interchangeable** — VERIFIED: `kling3_0_turbo`
declares only `start_image`, `marketing_studio_image` declares `image`. So
`higgsfieldModelRoles` asks the catalog (cached per process) instead of relying
on the server's "auto-coerce when unambiguous".

An **edit is a generation with a reference picture** — same submit, same poll, no
parallel lifecycle. `/api/v1/arc/media/edit` therefore got the same start/poll
treatment as the image route, with one shared `landEdit` tail, and the runner's
`edit_image` tool polls through the same helper as `generate_image`.

**Everything is start-then-poll now**, including Studio's "Change this image…".
`generateStudioAsset` returns a `status: "running"` variant on a job-based
engine and the client polls `pollStudioEdit`, exactly as its video button has
always worked. The submit happens **before** the source is downloaded, since
that engine imports the URL itself — a guard test enforces the ordering (and was
control-tested by reintroducing the bug).

The landing sequence — Library row → campaign draft → approval gate — is
extracted as `landStudioAsset` and called by **both** paths. A second copy is
exactly how Studio once wrote to the bucket and promoted a campaign asset
without ever writing a `media_assets` row (BSR-634), so the count of call sites
is itself asserted.

A poll is never metered: the submit was, and charging per "is it done yet" would
bill the operator for asking.

**Auto stays on Gemini** even though both engines execute. That is a spend
decision, not a capability one: Higgsfield bills the customer's own credits, and
reaching for them when nobody chose to is not a default to make on their behalf.

## Layer 3 — Reasoning model (which Claude model Arc *thinks* with)

**What the user chooses:** the quality/speed of Arc's brain.
**Status:** ✅ shipped — and it has been for a while. This doc claimed otherwise
until 2026-08-06; the composer has a model pill (`arc-view.tsx`, `MODEL_OPTIONS`
+ `resolveArcModelRoute`) offering **Arc Auto / Arc Spark / Arc Forge**.

⚠️ The **Pulse / Drive / Deep** names below appear nowhere in the code. Shipped
naming is Spark (fast) / Forge (standard); treat the table as the mapping, not
the labels.

**Recommendation: expose a branded tier, NOT raw model ids.** Raw ids rot (the
code is already a version behind — see below), users don't know Sonnet-vs-Opus,
and the cost rails (`maxBudgetUsd`, `maxTurns`) live per-tier. Keep it optional
and collapsed by default — most workspaces should never touch it.

Tier names are Arc-native (**Pulse / Drive / Deep**) — each carries its
speed/capability descriptor in the UI and maps to a Claude model under the hood:

| Tier (what the user sees) | Descriptor | Claude model | Model ID | When |
|---|---|---|---|---|
| **Arc Pulse** | Instant | Claude Sonnet 5 | `claude-sonnet-5` | Interactive chat — quick, cheap |
| **Arc Drive** *(default)* | Balanced | Claude Opus 4.8 | `claude-opus-4-8` | Drafting, scans, campaign work |
| **Arc Deep** | Maximum | Claude Opus 4.8 *(max deliberation)* | `claude-opus-4-8` | Hardest long-horizon runs |

**For right now the ceiling is Opus 4.8.** Deep runs the same model as Drive but
at maximum deliberation — deeper thinking budget, more turns, higher spend cap.
**Claude Fable 5** (`claude-fable-5`) is the intended future occupant of Deep once
its operational requirements (30-day data retention, refusal/fallback handling)
are cleared — enabling it is a one-line model swap.

Internally these map to the existing `ArcRoute` (`fast` → Pulse, `standard` →
Drive; `deep` is a new, dormant tier). Fallback per tier (keeps a turn alive if
the primary is unavailable): Pulse → `claude-haiku-4-5`, Drive → `claude-sonnet-5`,
Deep → `claude-opus-4-7`.

### Note: the runner is a version behind
`inference.ts` currently uses:
- FAST `claude-sonnet-4-6` → **should be `claude-sonnet-5`** (near-Opus quality at
  Sonnet cost; adaptive thinking on by default).
- STANDARD `claude-opus-4-8` → current, correct.

Independent of the picker, bumping FAST to Sonnet 5 is a one-line quality win.
(Sonnet 5 uses a new tokenizer ~30% heavier than 4.6 — re-baseline the
`maxBudgetUsd` rail when bumping.)

---

## Summary

| Layer | Choice | Default | State |
|---|---|---|---|
| 1. Backend | Higgsfield/Gemini on/off + credential | off until connected | ✅ done |
| 2. Media model | per-category model across BOTH engines | Auto (Gemini) | ✅ done — one resolver, both engines execute app-side |
| 3. Reasoning | Arc Auto / Spark / Forge | Auto | ✅ done — composer pill |

**Do next:** move Higgsfield images onto start-then-poll, reusing the video
flow's shape — that is what makes a 75s render land as an asset instead of a
message. Then `media_upload`, which unlocks Higgsfield image edits and
photo-to-video, the two capabilities that currently refuse with a reason.
