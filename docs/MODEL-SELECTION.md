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

**Known boundary:** the app still cannot *execute* Higgsfield — Arc drives it
through the `mcp__higgsfield` connector. A Higgsfield pick is therefore enforced
as a prompt-level required argument, not an app-side parameter, and Studio (which
runs in-process) offers Gemini models only when Higgsfield is the sole connection.
Closing that means an app-side Higgsfield MCP client; `checkHiggsfieldToken`
(`src/lib/connectors/higgsfield-health.ts`) already proves the transport works.

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
| 2. Media model | per-category model across BOTH engines | Auto (Arc picks) | ✅ done — one resolver, enforced as an argument |
| 3. Reasoning | Arc Auto / Spark / Forge | Auto | ✅ done — composer pill |

**Do next:** an app-side Higgsfield execution client, so a Higgsfield pick is a
parameter on a call the app makes rather than a required argument stated in a
prompt. Until then the Higgsfield half of Layer 2 is as strong as a prompt can
be, and no stronger — verify a Higgsfield generation names the picked model
before treating it as enforced.
