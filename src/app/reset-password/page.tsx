import Link from "next/link";

import { AuthBrandPanel } from "@/components/ui/auth-brand-panel";
import { FormValidityMessages } from "@/components/ui/form-validity";
import { SubmitOnEnter } from "@/components/ui/submit-on-enter";
import { PasswordField } from "@/components/ui/password-field";

export const metadata = { title: "Set a new password — Arc Studio" };

const RESET_ERRORS: Record<string, string> = {
  config: "Password reset isn't available right now. Try again shortly.",
  password: "Use at least 8 characters for your new password.",
  expired: "That reset link is invalid or has expired. Request a new one.",
  reuse: "That's already your current password. Choose a different one.",
  "1": "We couldn't update your password. Try again.",
};

const labelClass = "block text-[0.8125rem] font-medium text-[var(--text-secondary)] mb-1.5";
const inputClass =
  "w-full min-h-[44px] rounded-lg bg-[var(--surface-inset)] border border-[color:var(--border-panel)] px-3.5 text-[0.9375rem] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[color:var(--accent)] focus:bg-[var(--surface-panel)]";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? RESET_ERRORS[params.error] ?? "Something went wrong. Try again." : null;
  const expired = params.error === "expired";

  return (
    <main className="min-h-screen w-full bg-[var(--canvas)] text-[var(--text-primary)] lg:grid lg:grid-cols-[1fr_1.05fr]">
      <AuthBrandPanel headline="Set a new password." subline="Choose a new password and you'll be back in." />

      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[27rem]">
          <div className="mb-9 lg:hidden">
            <span className="flex items-center gap-2.5"><img src="/icon.png" alt="" className="h-8 w-auto" /><img src="/brand/arc-studio-wordmark.png" alt="Arc Studio" className="h-[1.3rem] w-auto" /></span>
          </div>

          <h2 className="font-[family-name:var(--font-display)] text-[1.6rem] font-semibold leading-tight text-[var(--text-primary)]">
            Set a new password
          </h2>
          <p className="mt-2 text-[0.925rem] text-[var(--text-secondary)]">Pick something you&apos;ll remember.</p>

          {error ? (
            <p role="alert" className="mt-6 rounded-lg border border-[color:color-mix(in_srgb,var(--priority)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--priority)_12%,transparent)] px-3.5 py-2.5 text-[0.85rem]">
              {error}
              {expired ? (
                <>
                  {" "}
                  <Link href="/forgot-password" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
                    Request a new link
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}

          <form action="/api/auth/reset-password" method="post" className="mt-7 space-y-4">
            <FormValidityMessages />
            <SubmitOnEnter />
            <div>
              <label htmlFor="password" className={labelClass}>
                New password
              </label>
              <PasswordField
                id="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                autoFocus
                placeholder="At least 8 characters"
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-[0.9375rem] font-semibold text-[var(--on-accent)] transition-[background-color,transform] hover:bg-[color:color-mix(in_srgb,var(--accent)_92%,white)] active:translate-y-px"
            >
              Update password
            </button>
          </form>

          <p className="mt-6 text-[0.875rem] text-[var(--text-secondary)]">
            <Link href="/login" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
