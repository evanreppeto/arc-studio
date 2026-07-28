import Link from "next/link";

import { inboxProviderUrl } from "@/lib/auth/pending-confirmation";

export type ResendStatus = "sent" | "rate_limited" | "error" | null;

const RESEND_MESSAGES: Record<Exclude<ResendStatus, null>, { tone: "ok" | "warn"; text: string }> = {
  sent: { tone: "ok", text: "Sent again — it should land within a minute." },
  rate_limited: {
    tone: "warn",
    text: "You've asked for a few of these already. Give it a minute before trying again.",
  },
  error: { tone: "warn", text: "That didn't go through. Try again in a moment." },
};

/**
 * What the operator sees after submitting sign-up.
 *
 * This replaces the form rather than sitting above it: the account already
 * exists at this point, so leaving an empty form on screen invites a second
 * submission and reads as though nothing happened. The address is echoed back so
 * a typo is caught here instead of in a support thread, and the next steps are
 * spelled out so the wait is legible.
 */
export function CheckInbox({
  email,
  from,
  resendStatus,
}: {
  email: string | null;
  from: string;
  resendStatus: ResendStatus;
}) {
  const provider = email ? inboxProviderUrl(email) : null;
  const resend = resendStatus ? RESEND_MESSAGES[resendStatus] : null;

  return (
    <div>
      <span
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
        aria-hidden
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2.75" y="4.75" width="18.5" height="14.5" rx="2.25" />
          <path d="M3.5 7.5 12 13l8.5-5.5" strokeLinecap="round" />
        </svg>
      </span>

      <h2 className="mt-5 font-serif text-[2rem] font-normal leading-[1.12] text-[var(--text-primary)]">
        Check your inbox
      </h2>

      <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
        {email ? (
          <>
            We sent a confirmation link to{" "}
            <span className="font-medium text-[var(--text-primary)]">{email}</span>. Open it and your
            workspace is ready — you&apos;ll land straight inside.
          </>
        ) : (
          <>
            We sent you a confirmation link. Open it and your workspace is ready — you&apos;ll land
            straight inside.
          </>
        )}
      </p>

      {provider ? (
        <a
          href={provider.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-[0.9375rem] font-semibold text-[var(--on-accent)] transition-[background-color,transform] hover:bg-[color:color-mix(in_srgb,var(--accent)_92%,white)] active:translate-y-px"
        >
          {provider.label}
        </a>
      ) : null}

      {/* What the link actually does — the wait is easier when the destination is known. */}
      <ol className="mt-7 space-y-3 border-t border-[color:var(--border-panel)] pt-6">
        {[
          "Confirm your email from the message we just sent.",
          "Arc sets up your workspace and starts from your industry's audiences.",
          "Invite your team, then review Arc's first drafts — nothing goes out without you.",
        ].map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[color:var(--border-panel)] bg-[var(--surface-inset)] font-[family-name:var(--font-mono)] text-[0.6875rem] text-[var(--text-muted)]">
              {i + 1}
            </span>
            <span className="text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-7 rounded-lg border border-[color:var(--border-panel)] bg-[var(--surface-inset)] px-4 py-3.5">
        <p className="text-[0.8125rem] leading-relaxed text-[var(--text-secondary)]">
          Nothing yet? It can take a minute. Check spam or promotions — the sender is{" "}
          <span className="font-[family-name:var(--font-mono)] text-[0.78rem] text-[var(--text-primary)]">
            team@arc-studio.ai
          </span>
          .
        </p>

        <form action="/api/auth/resend-confirmation" method="post" className="mt-3">
          <input type="hidden" name="from" value={from} />
          <button
            type="submit"
            className="min-h-[36px] rounded-lg border border-[color:var(--border-panel)] bg-[var(--surface-panel)] px-3.5 text-[0.8125rem] font-medium text-[var(--text-primary)] transition-colors hover:border-[color:var(--accent)]"
          >
            Resend the email
          </button>
        </form>

        {resend ? (
          <p
            role="status"
            className={`mt-2.5 text-[0.8125rem] ${
              resend.tone === "ok" ? "text-[var(--ok)]" : "text-[var(--warn)]"
            }`}
          >
            {resend.text}
          </p>
        ) : null}
      </div>

      <p className="mt-6 text-[0.875rem] text-[var(--text-secondary)]">
        Wrong address?{" "}
        <Link href="/sign-up" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
          Start over
        </Link>
        <span className="px-2 text-[var(--text-muted)]" aria-hidden>
          ·
        </span>
        Already confirmed?{" "}
        <Link href="/login" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
