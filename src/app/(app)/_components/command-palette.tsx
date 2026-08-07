"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useDialogFocus } from "./use-dialog-focus";

export type CommandItem = {
  label: string;
  href: string;
  group: string;
  keywords?: string;
};

/**
 * The ⌘K / "Search or jump to…" command menu. Before this the top-bar search was
 * a dead div on every screen. Opens on ⌘K/Ctrl-K anywhere, or on the
 * `arc:open-command` window event that the top-bar button dispatches. The open
 * content lives in a child that mounts fresh each open, so its query/selection
 * reset for free without a reset-effect.
 */
export function CommandPalette({ items }: { items: CommandItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("arc:open-command", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("arc:open-command", onOpen);
    };
  }, []);

  if (!open) return null;
  return <PaletteInner items={items} onClose={() => setOpen(false)} />;
}

function PaletteInner({ items, onClose }: { items: CommandItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  /* The Tab trap and focus restoration, plus Escape at the document level.
     Escape used to live on the INPUT's onKeyDown alone, so it stopped working
     the moment focus moved off the search field — and nothing kept Tab inside
     the palette, which claims `aria-modal="true"`. `moveFocusIn` is off because
     the effect below focuses the search input, which is the right target here. */
  useDialogFocus({ open: true, containerRef: cardRef, onEscape: onClose, moveFocusIn: false });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => `${it.label} ${it.group} ${it.keywords ?? ""}`.toLowerCase().includes(needle));
  }, [q, items]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        className="cmdk"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cmdk-search">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Search or jump to…"
            aria-label="Search or jump to a page"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = results[active];
                if (item) go(item.href);
              }
            }}
          />
          <span className="cmdk-esc">esc</span>
        </div>
        <div className="cmdk-list">
          {results.length === 0 ? (
            <div className="cmdk-empty">No matches for “{q}”</div>
          ) : (
            results.map((it, i) => (
              <button
                key={`${it.href}:${it.label}`}
                type="button"
                className={`cmdk-item${i === active ? " on" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it.href)}
              >
                <span className="cmdk-l">{it.label}</span>
                <span className="cmdk-g">{it.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
