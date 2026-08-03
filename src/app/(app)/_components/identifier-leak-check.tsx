"use client";

import { useEffect } from "react";

import { findIdentifierLeak } from "@/domain";

/**
 * Warn when the app renders something the database stores rather than something
 * a person wrote (BSR-709). Development and preview only — returns null and
 * registers nothing in production.
 *
 * This exists because the two source-scanning guards cannot see the general
 * case. `plumbing-vocabulary.test.ts` matches JSX string literals, and the
 * offending text here is a *value* — `{run.status}` has nothing to match until
 * it reaches a browser. Its companion check matches identifier-shaped field
 * names (`{x.key}`), which does not extend to `.kind` / `.status` / `.label`:
 * `media_assets.kind` is "image" and `knowledge_nodes.kind` is "crm_lead", and
 * no scanner can tell those two call sites apart.
 *
 * The DOM is the first place the value and the rendering exist together, so it
 * is the first place the question can actually be answered.
 *
 * Warns rather than throws. A leak is a copy bug, not a crash, and a check that
 * breaks the page someone is debugging gets deleted rather than fixed.
 */

/**
 * Subtrees whose text is expected to contain identifiers.
 *
 * `<pre>` and `<code>` carry raw tool output and payloads — the Arc run page
 * renders a tool's JSON response in a `<pre>`, and flagging that would be
 * flagging the feature. `[data-identifiers-ok]` is the escape hatch for anything
 * else deliberate; put it on the smallest element that covers the text.
 */
const SKIP_SELECTOR = "pre, code, script, style, textarea, [data-identifiers-ok]";

/**
 * Warn once per distinct string per page — the same label usually renders in a
 * list, and one warning is enough to find it.
 *
 * Parked on `window` rather than in module scope on purpose. StrictMode mounts
 * effects twice in dev, and Fast Refresh can leave a second copy of this module
 * in the graph after an edit; either way a module-level Set gives two
 * independent caches and every leak is reported twice. Duplicate warnings are
 * how a check starts reading as noise, so the cache has to outlive the module.
 */
const CACHE_KEY = "__identifierLeakSeen";
function seenSet(): Set<string> {
  const w = window as unknown as Record<string, Set<string> | undefined>;
  return (w[CACHE_KEY] ??= new Set<string>());
}

function describe(node: Text): string {
  const el = node.parentElement;
  if (!el) return "(detached)";
  const parts: string[] = [];
  for (let cur: HTMLElement | null = el; cur && parts.length < 3; cur = cur.parentElement) {
    const cls = typeof cur.className === "string" && cur.className ? `.${cur.className.trim().split(/\s+/)[0]}` : "";
    parts.unshift(`${cur.tagName.toLowerCase()}${cls}`);
  }
  return parts.join(" > ");
}

function scan(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = (node as Text).parentElement;
      if (!el || el.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const seen = seenSet();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const leak = findIdentifierLeak(text);
    if (!leak || seen.has(leak.match)) continue;
    seen.add(leak.match);
    console.warn(
      `[identifier-leak] rendered "${leak.match}" (${leak.shape}) — this looks like a stored value, not language.\n` +
        `  in: ${describe(node as Text)}\n` +
        `  text: ${text.trim().slice(0, 120)}\n` +
        `  Map it in src/domain/vocabulary.ts, or mark the element data-identifiers-ok if it is deliberate.`,
    );
  }
}

export function IdentifierLeakCheck() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    // Settle first: scanning during hydration reads a tree React is still
    // filling in, which reports text that never reaches the user.
    const initial = window.setTimeout(() => scan(document.body), 600);

    // Most of this app renders after a click, not on load — the Records editors,
    // the filter menus, every modal. A one-shot scan would only ever see the
    // first screen.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE) scan(added as Element);
          else if (added.nodeType === Node.TEXT_NODE) {
            const text = added.textContent ?? "";
            const leak = findIdentifierLeak(text);
            const seen = seenSet();
            if (leak && !seen.has(leak.match)) {
              seen.add(leak.match);
              console.warn(`[identifier-leak] rendered "${leak.match}" (${leak.shape}) — text: ${text.trim().slice(0, 120)}`);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, []);

  return null;
}
