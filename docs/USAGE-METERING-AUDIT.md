# Usage Metering Audit (BSR-502)

**Audited 2026-07-31 against production** (`qqbecyrhnowmooyjiztz`), covering every
`ai_usage_events` row ever written: 69 events, 2026-07-10 → 2026-07-31.

**Verdict: the meter undercounts, and cannot currently be reconciled.** Five
distinct gaps, four of them quantified from live data. None of them overcharge a
customer — every failure mode found runs in the direction of billing too little,
which is the safer direction but still means the caps in `src/domain/plans.ts` are
being enforced against a number that is not the real spend.

> The headline acceptance — reconciling recorded usage against actual Anthropic /
> Google invoices — is **not done**. It needs the provider billing consoles. What
> follows is everything that could be established from the code and the database,
> and it should make the invoice comparison much faster when someone runs it.

---

## What the meter contains

| | |
| --- | --- |
| Events | 69 |
| Services ever recorded | `arc_claude` **only** |
| Models | `claude-opus-4-8`, `claude-sonnet-5` |
| Recorded cost | **$15.37** total ($14.78 opus + $0.59 sonnet, the latter repriced 2026-07-31) |
| Input tokens | **620 total** (avg 9/event) |
| Output tokens | 239,404 |
| Null org / workspace | 0 / 0 |

---

## Finding 1 — the meter structurally cannot record embeddings

`ai_usage_service` is an enum with exactly three values: `arc_claude`,
`gemini_image`, `gemini_video`. **There is no value for embeddings, or for any
Gemini text call** (web research, news search).

This is not a call site that forgot to meter. There is nowhere to put the row.

Embedding generation is demonstrably live:

| | |
| --- | --- |
| `knowledge_nodes` | 491 |
| …with an embedding | **491** |
| Newest embedding | **2026-07-31** (today) |
| Embedding usage events | **0** |

Every Brain write embeds through `gemini-embedding-2`, and none of it has ever
been counted. Embeddings are individually cheap, which is exactly why this can
run for months unnoticed — and why it will scale with tenant count once signup
opens.

**Fix:** add enum values and meter the embedding path. Requires a migration, so
it is not in this change.

**Not a gap:** `gemini_image` / `gemini_video` have 0 events, but `media_assets`
is also 0 — media generation is credential-gated and genuinely unused. Correct,
not missing.

## Finding 2 — an entire production model is priced at zero

`claude-sonnet-5` is **not in `MODEL_PRICING`**, and `estimateClaudeCostCents`
documents its behaviour plainly:

```ts
/** Estimated cost (cents) of a Claude turn. Unknown model -> 0. */
const rate = resolveModelRate(model);
if (!rate) return 0;
```

| Model | Events | Output tokens | Recorded cost | `priced_model` |
| --- | --- | --- | --- | --- |
| `claude-opus-4-8` | 33 | 196,950 | $14.78 | `true` |
| `claude-sonnet-5` | 36 | 42,454 | **$0.00** | **`false`** |

**52% of all metered events cost nothing**, and the meter has been recording
`priced_model: false` on every one of them since 2026-07-10. The data to detect
this has existed the whole time. Nothing read it.

**Resolved 2026-07-31.** The operator supplied the published rate — 300/1500
cents per Mtok — and it is now in `MODEL_PRICING`, with `PRICING_VERSION` bumped
to `2026-07-31` so rows written under the old table stay attributable.

**The 36 historical rows were repriced on 2026-07-31**, taking them from $0.00 to
**59 cents** and the whole ledger from $14.78 to $15.37. Each carries an audit
trail in metadata — `repriced_at`, `repriced_from_version`, and the reason — and
`priced_model` was corrected to `true` alongside the amount, since leaving it
`false` would keep flagging rows that now hold a real cost in exactly the audit
that found them.

⚠️ **An earlier revision of this document said 64 cents. That was wrong**, and the
error is worth keeping visible because it is easy to repeat: 64 is what you get
rounding the *aggregate*, while `estimateClaudeCostCents` applies `Math.round` to
**each event**. Summing per-row roundings gives 59. A backfill computed from the
aggregate would have written a total the code itself could never produce.

## Finding 3 — input tokens are essentially unmetered

620 input tokens across 69 agent turns is an average of **nine**. That is not
possible for an agent that reads CRM records, conversation history and tool
results; output averages 1,179 (sonnet) and 5,968 (opus) on the same turns.

The runner takes its numbers from the SDK's final result message:

```ts
inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : inputTokens;
```

**Strong hypothesis, not yet confirmed:** with prompt caching enabled,
`input_tokens` excludes cached tokens — those are reported separately as
`cache_read_input_tokens` and `cache_creation_input_tokens`, which nothing reads.
That would explain the magnitude exactly. Cache reads are cheaper than base input
but **not free**, and cache *creation* is more expensive than base input, so the
missing side is real money.

Confirming this needs one raw `usage` payload logged from a live run — cheap to
do, and worth doing before anyone trusts an input-token figure.

## Finding 4 — a metering failure was invisible

`recordUsageEvent` caught its own insert failure and called `console.warn`. In a
serverless function that is effectively nowhere. **Consumption that fails to
meter is unbilled consumption** — the spend happened, we simply stopped knowing
about it. Fixed here.

## Finding 5 — every sub-half-cent call is free

Found while repricing Finding 2, and not visible before there was anything to
reprice. `estimateClaudeCostCents` ends in `Math.round(cents)`, so any event
costing less than half a cent records as **zero**.

Of the 36 repriced sonnet rows, **13 still hold $0.00** — not because the model is
unpriced any more, but because each individual call rounds to nothing.

At 69 events this is noise. It is a *systematic floor*, though, not a rounding
wobble: it only ever rounds down to zero, never up, so it cannot average out. The
error scales with the number of small calls, and short calls are exactly what a
chat-heavy product makes most of. A thousand tenants making brief turns would
accumulate a permanent, invisible discount.

**Fix:** store sub-cent precision — micro-cents in the ledger, rounded only at
display and at the cap comparison — rather than rounding at write time. Not done
here; it is a column change.

---

## The ticket's other questions

**Is metering attributed to the correct workspace?** Every one of the 69 events
has a non-null `org_id` and `workspace_id`, and the `/api/v1/arc/usage` route
takes both from the **bearer token scope** rather than the request body — so a
runner cannot assert someone else's tenant. That is the right design.

But it is **not proven absent**, because prod has one active org: there is no
second tenant to be misattributed to. This must be re-tested with two live
tenants before it can be called verified. Related: BSR-626 found the nightly scan
resolving tenants from an ambient request the cron does not have — the same class
of mistake, in the same shared-runner setting.

**How are retries, failures and cancellations treated?** Undocumented and
unhandled. A failed generation that still cost money is a real cost; a retry
after our own bug is not the customer's. Neither case is distinguished today.
Still open.

---

## What this change does, and deliberately does not

**Does:** an unpriced model now reports to Sentry (`ai-usage.unpriced-model`)
instead of being recorded silently at zero, and a metering failure reports
(`ai-usage.record`) instead of a `console.warn`. Both have tests.

**Prices `claude-sonnet-5`** at the operator-supplied rate of 300/1500 cents per
Mtok, with `PRICING_VERSION` bumped. The rate was **not inferred** — guessing in a
billing meter replaces a visible zero with an invisible wrong number, which is
strictly worse, so it waited for a real figure.

**The 36 historical rows were repriced separately**, as a direct database
operation rather than a code change (see Finding 2). Nothing in this repository
backfills the ledger, and nothing should: a backfill script that reprices rows on
deploy is a billing mutation running unattended.

**Does not invent prices for any other unknown model.** An unpriced model still
records zero, but now reports while doing it.

---

## Before arming `ARC_BILLING_ENFORCEMENT`

The caps in `src/domain/plans.ts` say in their own header that they are
*reasoned, not measured*. This audit does not change that — it establishes that
the meter they would be enforced against is **known to undercount**: the entire
embedding path, most of the input side, and every call too small to round up to a
cent. Pricing sonnet-5 closed the largest of the gaps, not the category.

Enforcement blocks real customer work. Doing it against a number this incomplete
is not defensible yet. Order: ~~price sonnet-5~~ (done 2026-07-31) → confirm the
cache-token hypothesis → meter embeddings → decide on sub-cent precision →
reconcile one month against real invoices → then arm.

**Last verified:** 2026-07-31.
