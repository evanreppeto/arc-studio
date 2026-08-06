"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppImage } from "./app-image";

type AccountMenuProps = {
  firstName: string;
  displayName: string;
  email: string;
  initials: string;
  avatarUrl?: string | null;
  settingsHref: string;
  supportHref?: string;
};

function Avatar({ url, initials, alt }: { url: string | null | undefined; initials: string; alt: string }) {
  return <span className="av">{url ? <AppImage src={url} alt={alt} /> : initials}</span>;
}

/**
 * The account control pinned to the bottom of the sidebar rail. Replaces the
 * old plain link-to-settings: the avatar now toggles a small menu (Team &
 * settings, Sign out). Sign out is a real form POST to /api/auth/sign-out so it
 * works without JS and clears the Supabase session before redirecting to /login.
 */
export function AccountMenu({
  firstName,
  displayName,
  email,
  initials,
  avatarUrl,
  settingsHref,
  supportHref,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onOpenAccountMenu() {
      setOpen(true);
    }
    function onCloseAccountMenu() {
      setOpen(false);
    }
    window.addEventListener("arc:open-account-menu", onOpenAccountMenu);
    window.addEventListener("arc:close-account-menu", onCloseAccountMenu);
    return () => {
      window.removeEventListener("arc:open-account-menu", onOpenAccountMenu);
      window.removeEventListener("arc:close-account-menu", onCloseAccountMenu);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="acct" ref={rootRef} data-open={open ? "true" : undefined}>
      {open && (
        <div id="account-menu" ref={menuRef} className="acct-menu" role="menu" aria-label="Account">
          <div className="acct-id">
            <Avatar url={avatarUrl} initials={initials} alt={displayName} />
            <div className="acct-id-t">
              <div className="nm">{displayName}</div>
              {email && <div className="em">{email}</div>}
            </div>
          </div>
          <div className="acct-sep" />
          <Link href={settingsHref} className="acct-item" role="menuitem" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7.63 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H1a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 2.6 7.63a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H7a1.65 1.65 0 0 0 1-1.51V1a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V7a1.65 1.65 0 0 0 1.51 1H23a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Team &amp; settings
          </Link>
          {supportHref && (
            <Link href={supportHref} className="acct-item" role="menuitem" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4" />
                <path d="M12 17h.01" />
              </svg>
              Help &amp; support
            </Link>
          )}
          <form action="/api/auth/sign-out" method="post">
            <button type="submit" className="acct-item danger" role="menuitem">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}
      <button
        id="account-menu-trigger"
        ref={triggerRef}
        type="button"
        className="user"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar url={avatarUrl} initials={initials} alt={displayName} />
        <span className="nm">{firstName}</span>
        <span className="cog" aria-hidden>
          <svg viewBox="0 0 24 24">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
    </div>
  );
}
