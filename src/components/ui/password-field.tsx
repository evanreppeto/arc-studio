"use client";

import { useState } from "react";

type PasswordFieldProps = {
  id: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  /** For forms where the password is the first field — puts focus in the form
   *  on load so Enter submits without clicking in first. */
  autoFocus?: boolean;
  /** The shared auth input class — the toggle adds its own right padding. */
  className: string;
};

/**
 * Password input with a show/hide toggle. Client component because flipping the
 * input type between "password" and "text" needs state. Matches the auth-page
 * input styling; the eye button sits inside the field on the right.
 */
export function PasswordField({
  id,
  name,
  autoComplete,
  required,
  minLength,
  placeholder,
  autoFocus,
  className,
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`${className} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        title={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)] focus-visible:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)]"
      >
        {show ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
            <path d="M9.36 5.21A9.46 9.46 0 0 1 12 4.9c5 0 9.1 4.34 9.1 7.1 0 1.02-1.05 2.72-2.77 4.14M6.23 6.22C3.98 7.63 2.9 9.66 2.9 12c0 2.76 4.1 7.1 9.1 7.1 1.4 0 2.72-.34 3.9-.93" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        )}
      </button>
    </div>
  );
}
