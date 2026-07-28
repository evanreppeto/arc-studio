"use client";

import { useState } from "react";

// The landing page's conversion moment while Arc Studio is pre-pricing: an
// email capture instead of self-serve sign-up. Posts to /api/waitlist
// (idempotent — re-joining reads as success).
export function WaitlistForm({
  source,
  align = "left",
}: {
  source: string;
  align?: "left" | "center";
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    setMessage(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      if (res.status === 400) {
        const data = (await res.json()) as { error?: string };
        setState("error");
        setMessage(data.error ?? "That doesn't look like a valid email address.");
        return;
      }
      if (!res.ok && res.status !== 202) {
        setState("error");
        setMessage("Something went wrong — try again in a moment.");
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setMessage("Something went wrong — try again in a moment.");
    }
  };

  if (state === "done") {
    return (
      <div
        className={`flex min-h-[48px] items-center gap-2.5 ${align === "center" ? "justify-center" : ""}`}
        role="status"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--ok)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--ok)_12%,transparent)]">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--ok)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12l5 5L20 7" />
          </svg>
        </span>
        <p className="text-[0.925rem] text-[var(--text-primary)]">
          You&apos;re on the list — we&apos;ll be in touch when your spot opens.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={align === "center" ? "mx-auto w-full max-w-[30rem]" : "w-full max-w-[30rem]"}>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <label className="sr-only" htmlFor={`waitlist-email-${source}`}>
          Email address
        </label>
        <input
          id={`waitlist-email-${source}`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          className="min-h-[48px] flex-1 rounded-lg border border-[color:var(--border-panel)] bg-[color:color-mix(in_srgb,var(--surface-inset)_82%,transparent)] px-4 text-[0.9375rem] text-[var(--text-primary)] backdrop-blur placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[color:color-mix(in_srgb,var(--accent)_60%,transparent)] focus:bg-[var(--surface-panel)]"
        />
        <button
          type="submit"
          disabled={state === "submitting"}
          className="group relative flex min-h-[48px] items-center justify-center overflow-hidden rounded-lg bg-[var(--accent)] px-6 text-[0.95rem] font-semibold text-[var(--on-accent)] transition-[transform,box-shadow,filter] duration-300 ease-out hover:scale-[1.03] hover:brightness-110 hover:shadow-[0_14px_36px_-10px_rgba(200,162,74,0.6)] active:scale-100 active:translate-y-px disabled:cursor-wait disabled:opacity-80 motion-reduce:transform-none"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-[130%] bg-[linear-gradient(105deg,transparent_38%,rgba(255,255,255,0.42)_50%,transparent_62%)] transition-transform duration-700 ease-out group-hover:translate-x-[130%] motion-reduce:hidden"
          />
          <span className="relative z-10">
            {state === "submitting" ? "Joining…" : "Join the waitlist"}
          </span>
        </button>
      </div>
      {state === "error" && message ? (
        <p className={`mt-2 text-[0.8rem] text-[var(--priority)] ${align === "center" ? "text-center" : ""}`} role="alert">
          {message}
        </p>
      ) : (
        <p className={`mt-2 text-[0.8rem] text-[var(--text-muted)] ${align === "center" ? "text-center" : ""}`}>
          We&apos;re onboarding teams gradually — we&apos;ll reach out when a spot opens.
        </p>
      )}
    </form>
  );
}
