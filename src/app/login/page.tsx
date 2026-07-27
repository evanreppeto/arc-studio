import Link from "next/link";

import { AuthBrandPanel } from "@/components/ui/auth-brand-panel";
import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { FormValidityMessages } from "@/components/ui/form-validity";
import { PasswordField } from "@/components/ui/password-field";

export const metadata = {
  title: "Sign in — Arc Studio",
};

const SIGN_IN_ERRORS: Record<string, string> = {
  invalid: "That email or password didn't match. Try again.",
  unconfirmed: "Confirm your email first — check your inbox for the link.",
  rate_limited: "Too many attempts. Wait a moment, then try again.",
  provision: "You're signed in, but setup didn't finish. Try again.",
  config: "Sign-in isn't switched on yet. Try again shortly.",
  // Email links land here when the token can't be redeemed — expired, already
  // used, or opened in a different browser than it was requested from. The
  // address is confirmed by the time Supabase redirects, so signing in with a
  // password is the way through; the old copy ("Something went wrong") sent
  // people back to their inbox to click the same dead link again.
  link: "That link couldn't be used — it may have expired, or already been opened. Sign in with your password below.",
  oauth: "That sign-in link couldn't be completed. Sign in with your password below.",
  oauth_cancelled: "Sign-in was cancelled. Try again, or use your password below.",
  "1": "That email or password didn't match. Try again.",
};

type SearchParams = { error?: string; from?: string; reset?: string };

const labelClass = "block text-[0.8125rem] font-medium text-[var(--text-secondary)] mb-1.5";
const inputClass =
  "w-full min-h-[44px] rounded-lg bg-[var(--surface-inset)] border border-[color:var(--border-panel)] px-3.5 text-[0.9375rem] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[color:var(--accent)] focus:bg-[var(--surface-panel)]";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const error = params.error ? SIGN_IN_ERRORS[params.error] ?? "Something went wrong. Try again." : null;
  const from = params.from ?? "/home";
  const resetDone = params.reset === "1";

  return (
    <main className="min-h-screen w-full bg-[var(--canvas)] text-[var(--text-primary)] lg:grid lg:grid-cols-[1fr_1.05fr]">
      <AuthBrandPanel
        headline="Welcome back."
        subline="Sign in to review what Arc has prepared — every draft still waits for your approval."
      />

      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[27rem]">
          <div className="mb-9 lg:hidden">
            <span className="flex items-center gap-2.5"><img src="/icon.png" alt="" className="h-8 w-auto" /><img src="/brand/arc-studio-wordmark.png" alt="Arc Studio" className="h-[1.3rem] w-auto" /></span>
          </div>

          <h2 className="font-[family-name:var(--font-display)] text-[1.6rem] font-semibold leading-tight text-[var(--text-primary)]">
            Sign in
          </h2>
          <p className="mt-2 text-[0.925rem] text-[var(--text-secondary)]">
            Welcome back to Arc Studio.
          </p>

          {error ? (
            <p
              role="alert"
              className="mt-6 rounded-lg border border-[color:color-mix(in_srgb,var(--priority)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--priority)_12%,transparent)] px-3.5 py-2.5 text-[0.85rem] text-[var(--text-primary)]"
            >
              {error}
            </p>
          ) : null}

          {resetDone ? (
            <p role="status" className="mt-6 rounded-lg border border-[color:color-mix(in_srgb,var(--ok)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--ok)_12%,transparent)] px-3.5 py-2.5 text-[0.85rem] text-[var(--text-primary)]">
              Your password was updated. Sign in with it below.
            </p>
          ) : null}

          <form action="/api/auth/sign-in" method="post" className="mt-7 space-y-4">
            <FormValidityMessages />
            <input type="hidden" name="from" value={from} />

            <div>
              <label htmlFor="email" className={labelClass}>
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@company.com"
                className={inputClass}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-[0.8125rem] font-medium text-[var(--text-secondary)]">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-[0.8125rem] text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text-secondary)]"
                >
                  Forgot?
                </Link>
              </div>
              <PasswordField
                id="password"
                name="password"
                autoComplete="current-password"
                required
                className={inputClass}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-[0.85rem] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                name="rememberMe"
                value="1"
                defaultChecked
                className="h-4 w-4 rounded border-[color:var(--border-panel)] bg-[var(--surface-inset)] accent-[var(--accent)]"
              />
              Keep me signed in
            </label>

            <button
              type="submit"
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-[0.9375rem] font-semibold text-[var(--on-accent)] transition-[background-color,transform] hover:bg-[color:color-mix(in_srgb,var(--accent)_92%,white)] active:translate-y-px"
            >
              Sign in
            </button>
          </form>

          <p className="mt-6 text-[0.875rem] text-[var(--text-secondary)]">
            New to Arc Studio?{" "}
            {isSelfServeSignupOpen() ? (
              <Link href="/sign-up" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
                Create your workspace
              </Link>
            ) : (
              <Link href="/#waitlist" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
                Join the waitlist
              </Link>
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
