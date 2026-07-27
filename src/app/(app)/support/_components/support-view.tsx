"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";

import {
  SUPPORT_BODY_MAX,
  SUPPORT_CATEGORIES,
  SUPPORT_IMPACTS,
  SUPPORT_SUBJECT_MAX,
  type SupportCategory,
  type SupportDiagnostics,
  type SupportImpact,
} from "@/domain";
import type { SupportRequestView } from "@/lib/support/read-model";

import { submitSupportRequest } from "../actions";

// Routes an operator can name as "where it happened". Kept in the same order as
// the nav rail so the list reads like the app looks.
const PLACES: { value: string; label: string }[] = [
  { value: "", label: "Not tied to one page" },
  { value: "/arc", label: "Arc" },
  { value: "/home", label: "Home" },
  { value: "/campaigns", label: "Campaigns" },
  { value: "/crm", label: "Relationships" },
  { value: "/opportunities", label: "Opportunities" },
  { value: "/analytics", label: "Analytics" },
  { value: "/journeys", label: "Journeys" },
  { value: "/brain", label: "Brain" },
  { value: "/personas", label: "Personas" },
  { value: "/studio", label: "Studio" },
  { value: "/library", label: "Library" },
  { value: "/brand", label: "Brand" },
  { value: "/outbox", label: "Outbox" },
  { value: "/settings", label: "Settings" },
];

// Self-service first: the fixes that resolve most reports, pointing at the real
// surfaces that own each one. Tenant-agnostic — no workspace is named.
const ANSWERS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Arc isn't replying, or a run looks stuck",
    a: (
      <>
        Check <b>Settings → System status</b> first — it reports whether the Arc runner, database, and model
        connections are reachable. A run that stalls mid-thought usually means the runner lost its connection;
        starting a new conversation is the fastest unblock. If status is green and Arc still won&rsquo;t answer,
        report it below with the conversation open in another tab.
      </>
    ),
  },
  {
    q: "My campaign hasn't gone out",
    a: (
      <>
        That&rsquo;s usually working as designed: nothing reaches the outside world without an explicit human
        approval. Open the campaign and confirm the asset is <b>Approved</b> (not draft or awaiting revision),
        then check <b>Outbox</b> for the queued send. If it&rsquo;s approved and still queued, sending may not be
        armed for this workspace yet — tell us below and we&rsquo;ll check the send configuration.
      </>
    ),
  },
  {
    q: "A page is empty, or the numbers look wrong",
    a: (
      <>
        Empty usually means the underlying source isn&rsquo;t connected yet — check{" "}
        <b>Settings → Connections</b> for the relevant integration. Wrong numbers are worth reporting: include the
        page, what you expected, and what you saw. Screenshots help, and you can reply to our email with them once
        you&rsquo;ve sent the request below.
      </>
    ),
  },
  {
    q: "A teammate can't get in",
    a: (
      <>
        Invites are managed in <b>Settings → Team</b> — re-send the invite there and have them use the emailed
        link, which works whether or not they already have an account. If the invite email never arrives, check
        their spam folder first, then report it below with the address you invited.
      </>
    ),
  },
  {
    q: "Image or video generation isn't producing anything",
    a: (
      <>
        Media models are enabled per workspace in <b>Settings → Connections</b>, and generation is metered and
        spend-capped. If the connector is off, or the cap is reached, generation quietly produces nothing new.
        Turn it on there, or ask us below to check your remaining allowance.
      </>
    ),
  },
  {
    q: "Something broke right after an update",
    a: (
      <>
        Try a hard reload first (⇧⌘R on Mac, Ctrl+F5 on Windows) — a stale cached bundle after a deploy explains
        most sudden breakage. If it survives a hard reload, report it below: the build id is attached
        automatically, which is what lets us pin it to the exact deploy.
      </>
    ),
  },
];

// Browser context, read once and cached at module scope so the snapshot getter
// below returns a stable reference (useSyncExternalStore re-renders forever on a
// fresh object each call). The server snapshot is empty and the client corrects
// after hydration — same contract as the shell's `embedded` check.
const NO_ENV: SupportDiagnostics = {};
let clientEnv: SupportDiagnostics | null = null;
const noopSubscribe = () => () => {};

function readClientEnv(): SupportDiagnostics {
  if (!clientEnv) {
    clientEnv = {
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  return clientEnv;
}

/** The page they navigated here from, when it's one of the routes we list. */
function readReferrerPlace(): string {
  try {
    const url = new URL(document.referrer);
    if (url.origin !== window.location.origin) return "";
    return PLACES.find((p) => p.value && url.pathname.startsWith(p.value))?.value ?? "";
  } catch {
    return "";
  }
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Sent = { reference: string | null; persisted: boolean; notified: boolean };

export function SupportView({
  workspaceName,
  viewerEmail,
  supportInbox,
  appVersion,
  mailtoHref,
  requests,
  canPersist,
}: {
  workspaceName: string;
  viewerEmail: string;
  supportInbox: string;
  appVersion: string;
  mailtoHref: string;
  requests: SupportRequestView[];
  canPersist: boolean;
}) {
  const [category, setCategory] = useState<SupportCategory>("bug");
  const [impact, setImpact] = useState<SupportImpact>("slowing");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [pending, startTransition] = useTransition();

  // Shown in full in "What gets attached" — we never send anything the operator
  // can't see before they hit send.
  const env = useSyncExternalStore(noopSubscribe, readClientEnv, () => NO_ENV);
  // "Where" defaults to the page they came from until they pick one themselves.
  const detectedPlace = useSyncExternalStore(noopSubscribe, readReferrerPlace, () => "");
  const [pickedPlace, setPickedPlace] = useState<string | null>(null);
  const place = pickedPlace ?? detectedPlace;

  const categoryMeta = useMemo(() => SUPPORT_CATEGORIES.find((c) => c.key === category), [category]);
  const bodyLabel =
    category === "bug"
      ? "What happened — and what you expected instead"
      : category === "feature"
        ? "What you'd like to be able to do"
        : "Tell us more";

  function reset() {
    setSent(null);
    setSubject("");
    setBody("");
    setError(null);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitSupportRequest({
        category,
        impact,
        subject,
        body,
        diagnostics: { ...env, pagePath: place, capturedAt: new Date().toISOString() },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent({ reference: result.reference, persisted: result.persisted, notified: result.notified });
    });
  }

  return (
    <div className="support">
      <header className="sup-head">
        <div>
          <h1>Help &amp; support</h1>
          <p className="sup-lede">
            Something broken, something confusing, or something you wish Arc could do — this reaches a human.
          </p>
        </div>
        <a className="btn ghost sup-mailbtn" href={mailtoHref}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M3 6h18v12H3z" />
            <path d="M3 7l9 6 9-6" />
          </svg>
          Email us directly
        </a>
      </header>

      <div className="sup-cols">
        <section className="sup-panel sup-formpanel">
          <div className="sup-panel-h">
            <h2>Report an issue or ask a question</h2>
            <span className="sup-sub">Goes to {supportInbox}</span>
          </div>

          {sent ? (
            <div className="sup-done">
              <div className="sup-donemk" aria-hidden>
                ✓
              </div>
              <h3>{sent.persisted ? "We've got it." : "Ready to send."}</h3>
              {sent.persisted ? (
                <p>
                  Logged as <b>{sent.reference}</b>
                  {viewerEmail ? (
                    <>
                      {" "}
                      — we&rsquo;ll reply to <b>{viewerEmail}</b>.
                    </>
                  ) : (
                    "."
                  )}{" "}
                  {impact === "blocking" ? "Blocking issues get looked at first." : "We read every request."}
                </p>
              ) : (
                <p>
                  This workspace isn&rsquo;t connected to a database, so there was nothing to save it to. Send it
                  by email instead — the button below opens a message with your workspace and build already filled
                  in.
                </p>
              )}
              {sent.persisted && !sent.notified && (
                <p className="sup-warn">
                  Your request is saved, but our notification email didn&rsquo;t go out. To be sure a human sees it
                  today, email us directly as well.
                </p>
              )}
              <div className="sup-doneacts">
                <button type="button" className="btn ghost" onClick={reset}>
                  Send another
                </button>
                {(!sent.persisted || !sent.notified) && (
                  <a className="btn" href={mailtoHref}>
                    Email {supportInbox}
                  </a>
                )}
              </div>
            </div>
          ) : (
            <form className="sup-form" onSubmit={onSubmit}>
              <div className="sup-field">
                <span className="sup-label">What do you need?</span>
                <div className="sup-cats">
                  {SUPPORT_CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className={`sup-cat${category === c.key ? " on" : ""}`}
                      onClick={() => setCategory(c.key)}
                      aria-pressed={category === c.key}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {categoryMeta && <span className="sup-hint">{categoryMeta.hint}</span>}
              </div>

              <div className="sup-row">
                <label className="sup-field">
                  <span className="sup-label">Summary</span>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={SUPPORT_SUBJECT_MAX}
                    placeholder={
                      category === "bug" ? "Campaign approval button does nothing" : "How do I add a teammate?"
                    }
                    required
                  />
                </label>
                <label className="sup-field sup-place">
                  <span className="sup-label">Where</span>
                  <select value={place} onChange={(e) => setPickedPlace(e.target.value)}>
                    {PLACES.map((p) => (
                      <option key={p.label} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="sup-field">
                <span className="sup-label">{bodyLabel}</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={SUPPORT_BODY_MAX}
                  rows={7}
                  placeholder={
                    category === "bug"
                      ? "I clicked Approve on the draft email and the page just sat there. I expected it to move to Outbox."
                      : "As much detail as you can give us — the more specific, the faster we can help."
                  }
                  required
                />
                <span className="sup-count">
                  {body.length}/{SUPPORT_BODY_MAX}
                </span>
              </label>

              <div className="sup-field">
                <span className="sup-label">How much is this affecting you?</span>
                <div className="sup-impacts">
                  {SUPPORT_IMPACTS.map((i) => (
                    <button
                      key={i.key}
                      type="button"
                      className={`sup-impact${impact === i.key ? ` on ${i.key}` : ""}`}
                      onClick={() => setImpact(i.key)}
                      aria-pressed={impact === i.key}
                    >
                      <b>{i.label}</b>
                      <span>{i.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <details className="sup-diag">
                <summary>
                  What gets attached
                  <span className="sup-diagn">{viewerEmail ? "5 details" : "4 details"}</span>
                </summary>
                <ul>
                  <li>
                    <span>Workspace</span>
                    <b>{workspaceName}</b>
                  </li>
                  {viewerEmail && (
                    <li>
                      <span>Your account</span>
                      <b>{viewerEmail}</b>
                    </li>
                  )}
                  <li>
                    <span>Build</span>
                    <b>{appVersion || "unknown"}</b>
                  </li>
                  <li>
                    <span>Browser</span>
                    <b className="sup-ua">{env.userAgent || "—"}</b>
                  </li>
                  <li>
                    <span>Screen &amp; timezone</span>
                    <b>
                      {env.viewport || "—"} · {env.timezone || "—"}
                    </b>
                  </li>
                </ul>
                <p>Nothing else is collected. Your campaign, contact, and message content is never attached.</p>
              </details>

              {error && <div className="sup-err">{error}</div>}
              {!canPersist && !error && (
                <div className="sup-note">
                  This workspace isn&rsquo;t connected to a database right now, so requests can&rsquo;t be logged —
                  use <b>Email us directly</b>
                  {" above and it’ll reach the same place."}
                </div>
              )}

              <div className="sup-acts">
                <span className="sup-actnote">
                  {impact === "blocking" ? "Blocking issues get looked at first." : "We read every request."}
                </span>
                <button type="submit" className="btn" disabled={pending}>
                  {pending ? "Sending…" : "Send to support"}
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className="sup-side">
          <section className="sup-panel">
            <div className="sup-panel-h">
              <h2>Try this first</h2>
              <span className="sup-sub">Fixes most reports</span>
            </div>
            <div className="sup-faq">
              {ANSWERS.map((item) => (
                <details key={item.q}>
                  <summary>
                    {item.q}
                    <span className="sup-plus" aria-hidden>
                      +
                    </span>
                  </summary>
                  <div className="sup-a">{item.a}</div>
                </details>
              ))}
            </div>
          </section>

          <section className="sup-panel">
            <div className="sup-panel-h">
              <h2>Other ways to reach us</h2>
            </div>
            <div className="sup-ways">
              <a className="sup-way" href={mailtoHref}>
                <span className="sup-waymk" aria-hidden>
                  @
                </span>
                <span>
                  <b>{supportInbox}</b>
                  <i>Opens a message with your workspace and build filled in</i>
                </span>
              </a>
              <div className="sup-way static">
                <span className="sup-waymk" aria-hidden>
                  ⚙
                </span>
                <span>
                  <b>Settings → System status</b>
                  <i>Check whether Arc, the database, and your connections are reachable</i>
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section className="sup-panel sup-history">
        <div className="sup-panel-h">
          <h2>Your workspace&rsquo;s requests</h2>
          <span className="sup-sub">{requests.length > 0 ? `${requests.length} logged` : "Nothing yet"}</span>
        </div>
        {requests.length === 0 ? (
          <div className="sup-empty">
            Nothing reported from this workspace yet. Anything you send above shows up here with its status, so
            your whole team can see what&rsquo;s already been raised.
          </div>
        ) : (
          <ul className="sup-list">
            {requests.map((r) => (
              <li key={r.id}>
                <details>
                  <summary>
                    <span className={`sup-pill t-${r.statusTone}`}>{r.statusLabel}</span>
                    <span className="sup-subj">{r.subject}</span>
                    <span className="sup-meta">
                      {r.categoryLabel} · {r.submittedBy} · {relative(r.createdAt)}
                    </span>
                    <span className="sup-ref">{r.reference}</span>
                  </summary>
                  <div className="sup-detail">
                    <p className="sup-body">{r.body}</p>
                    <div className="sup-detailmeta">
                      <span>Impact: {r.impactLabel}</span>
                      {r.pagePath && <span>Page: {r.pagePath}</span>}
                    </div>
                    {r.resolutionNote && <p className="sup-res">{r.resolutionNote}</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
