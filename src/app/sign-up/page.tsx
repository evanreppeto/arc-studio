import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { PENDING_CONFIRMATION_COOKIE, readPendingConfirmationEmail } from "@/lib/auth/pending-confirmation";

import { AuthBrandPanel } from "@/components/ui/auth-brand-panel";
import { FormValidityMessages } from "@/components/ui/form-validity";
import { PasswordField } from "@/components/ui/password-field";
import { INDUSTRY_OPTIONS } from "@/lib/personas/industry-templates";

import { CheckInbox, type ResendStatus } from "./_components/check-inbox";

export const metadata = {
  title: "Create your workspace — Arc Studio",
};

const WORKSPACE_TYPES = [
  { value: "company", label: "In-house team" },
  { value: "agency", label: "Agency" },
  { value: "individual", label: "Solo" },
];

const SIGN_UP_ERRORS: Record<string, string> = {
  config: "Sign-up isn't switched on yet. Try again in a moment.",
  password: "Use at least 8 characters for your password.",
  exists: "An account with that email already exists — sign in instead.",
  name: "Enter your first and last name.",
  organization: "Enter a name for your company or workspace.",
  workspace_intent: "Pick whether you're creating or joining a workspace.",
  provision: "Your account was created, but setup didn't finish. Sign in to continue.",
  resend_expired: "That sign-up has timed out. Enter your details again to get a fresh link.",
  "1": "Something went wrong creating your account. Try again.",
};

const RESEND_STATUSES = new Set(["sent", "rate_limited", "error"]);

type SearchParams = { error?: string; success?: string; from?: string; resend?: string };

const labelClass = "block text-[0.8125rem] font-medium text-[var(--text-secondary)] mb-1.5";
const inputClass =
  "w-full min-h-[44px] rounded-lg bg-[var(--surface-inset)] border border-[color:var(--border-panel)] px-3.5 text-[0.9375rem] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[color:var(--accent)] focus:bg-[var(--surface-panel)]";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Pre-pricing: self-serve sign-up stays closed in production (supabase mode)
  // and the landing waitlist is the front door. Invited teammates still join
  // through /accept-invite, and ARC_SELF_SERVE_SIGNUP=1 reopens this page.
  if (!isSelfServeSignupOpen()) {
    redirect("/#waitlist");
  }

  const params = await searchParams;
  const error = params.error ? SIGN_UP_ERRORS[params.error] ?? "Something went wrong. Try again." : null;
  const checkEmail = params.success === "check_email";
  const from = params.from ?? "/home";
  const resendStatus: ResendStatus =
    params.resend && RESEND_STATUSES.has(params.resend) ? (params.resend as ResendStatus) : null;

  // The address is known only from the httpOnly cookie the sign-up route set —
  // deliberately not a query param, so it stays out of history and referrers.
  const pendingEmail = checkEmail
    ? readPendingConfirmationEmail((await cookies()).get(PENDING_CONFIRMATION_COOKIE)?.value)
    : null;

  // Waiting for confirmation is its own moment, so the brand column changes line
  // with it rather than leaving a banner bolted onto a dead form.
  const headline = checkEmail ? (
    <>One link away from your workspace.</>
  ) : (
    <>Marketing that does the work — you keep the final say.</>
  );
  const subline = checkEmail
    ? "The moment you confirm, Arc starts building your workspace around your industry, your audiences, and your proof."
    : "Arc finds source-backed opportunities, drafts campaigns, and prepares creative from your real proof. Nothing reaches a customer until you approve it.";

  return (
    <main className="min-h-screen w-full bg-[var(--canvas)] text-[var(--text-primary)] lg:grid lg:grid-cols-[1fr_1.05fr]">
      <AuthBrandPanel headline={headline} subline={subline} />

      {/* Form column */}
      <section className="flex items-center justify-center px-6 py-8 sm:px-10">
        <div className="w-full max-w-[27rem]">
          <div className="mb-9 lg:hidden">
            <span className="flex items-center gap-2.5">
              <Image src="/icon.png" alt="" width={32} height={32} priority className="h-8 w-8" />
              <Image
                src="/brand/arc-studio-wordmark.png"
                alt="Arc Studio"
                width={152}
                height={27}
                priority
                className="h-[1.3rem] w-auto"
              />
            </span>
          </div>

          {checkEmail ? (
            <CheckInbox email={pendingEmail} from={from} resendStatus={resendStatus} />
          ) : (
            <SignUpForm error={error} from={from} />
          )}
        </div>
      </section>
    </main>
  );
}

/** The create-a-workspace form itself — swapped out wholesale once submitted. */
function SignUpForm({ error, from }: { error: string | null; from: string }) {
  return (
    <>
      <h2 className="font-[family-name:var(--font-display)] text-[1.6rem] font-semibold leading-tight text-[var(--text-primary)]">
        Create your workspace
      </h2>
      <p className="mt-2 text-[0.925rem] text-[var(--text-secondary)]">
        Set up your company on Arc Studio. You can invite your team next.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-[color:color-mix(in_srgb,var(--priority)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--priority)_12%,transparent)] px-3.5 py-2.5 text-[0.85rem] text-[var(--text-primary)]"
        >
          {error}
        </p>
      ) : null}

      <form action="/api/auth/sign-up" method="post" className="mt-5 space-y-3">
        <FormValidityMessages />
        <input type="hidden" name="workspaceIntent" value="create" />
        <input type="hidden" name="from" value={from} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className={labelClass}>
              First name
            </label>
            <input id="firstName" name="firstName" autoComplete="given-name" required className={inputClass} />
          </div>
          <div>
            <label htmlFor="lastName" className={labelClass}>
              Last name
            </label>
            <input id="lastName" name="lastName" autoComplete="family-name" required className={inputClass} />
          </div>
        </div>

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
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <PasswordField
            id="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="organizationName" className={labelClass}>
            Company name
          </label>
          <input
            id="organizationName"
            name="organizationName"
            autoComplete="organization"
            required
            placeholder="Acme Inc."
            className={inputClass}
          />
        </div>

        <div>
          <span className={labelClass}>What are you running?</span>
          <div className="grid grid-cols-3 gap-2">
            {WORKSPACE_TYPES.map((t, i) => (
              <label
                key={t.value}
                className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg border border-[color:var(--border-panel)] bg-[var(--surface-inset)] px-2 text-center text-[0.85rem] text-[var(--text-secondary)] transition-colors has-[:checked]:border-[color:var(--accent)] has-[:checked]:bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] has-[:checked]:text-[var(--text-primary)]"
              >
                <input
                  type="radio"
                  name="workspaceType"
                  value={t.value}
                  defaultChecked={i === 0}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="industry" className={labelClass}>
            Your industry
          </label>
          <select id="industry" name="industry" defaultValue="general" className={inputClass}>
            {INDUSTRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
            Arc uses this to start with relevant audiences and language. You can change them later.
          </p>
        </div>

        <button
          type="submit"
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-[0.9375rem] font-semibold text-[var(--on-accent)] transition-[background-color,transform] hover:bg-[color:color-mix(in_srgb,var(--accent)_92%,white)] active:translate-y-px"
        >
          Create workspace
        </button>
      </form>

      <p className="mt-6 text-[0.875rem] text-[var(--text-secondary)]">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
