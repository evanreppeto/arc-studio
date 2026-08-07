"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/**
 * Home "Quick actions" — the buttons AND their keyboard shortcuts share one
 * definition, so a badge can never advertise a key that does nothing (the
 * previous static "C"/"L" hints were decorative — no handler existed).
 *
 * The keys are bare single presses (c / l / a), scoped to the Home screen: the
 * listener lives on this component, so it only fires while Home is mounted, and
 * it stands down whenever a modifier is held (Ctrl+C etc. stay the browser's),
 * a field is focused, or a dialog is open. Each key just navigates — the same
 * href the button uses — so there's nothing outbound and nothing to undo.
 */
type QuickAction = { key: string; label: string; href: string; icon: ReactNode };

const ACTIONS: QuickAction[] = [
  {
    key: "c",
    label: "New campaign",
    // Opens the New-campaign modal, rather than dropping you on the board to go
    // find the button. "Quick action" should mean the action.
    href: "/campaigns?new=1",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    key: "l",
    label: "Add a lead",
    // Leads, with the Add modal open. Pointing at `/crm` landed on Contacts
    // with nothing open — the wrong tab AND no action.
    href: "/crm?o=leads&add=1",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      </svg>
    ),
  },
  {
    key: "a",
    label: "Ask Arc",
    href: "/arc",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M21 12a9 9 0 1 1-3.2-6.9L21 4v5h-5" />
      </svg>
    ),
  },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function QuickActions() {
  const router = useRouter();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Leave modified combos to the browser/OS and the ⌘K palette, and don't
      // hijack a key the user is typing into a field or that a dialog owns.
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const match = ACTIONS.find((a) => a.key === event.key.toLowerCase());
      if (!match) return;
      event.preventDefault();
      router.push(match.href);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="qa">
      {ACTIONS.map((a) => (
        <Link className="qbtn" href={a.href} key={a.key}>
          {a.icon}
          {a.label}
          <span className="kk">{a.key.toUpperCase()}</span>
        </Link>
      ))}
    </div>
  );
}
