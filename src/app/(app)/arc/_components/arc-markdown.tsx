"use client";

// The Arc chat's markdown + streaming engine, factored out so answers, streamed
// text, and reasoning all render identically wherever they appear. Self-contained:
// depends only on react-markdown / highlight.js / motion — no other arc component —
// so both the live and demo conversation renderers import from here.

import { isValidElement, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useReducedMotion } from "motion/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Smoothly reveal streamed text. The runner posts partial reply bodies that the
 * client only re-fetches on a poll (~1–2.5s apart), so without smoothing the
 * answer lands in visible chunks. This reveals the target at a steady,
 * backlog-aware cadence so it reads as continuous typing — a bigger backlog
 * reveals faster, so a fresh chunk catches up in a beat instead of dumping — and
 * snaps to full the instant streaming ends or reduced-motion is requested.
 */
export function useSmoothStream(target: string, streaming: boolean): string {
  const reduceMotion = useReducedMotion();
  const [count, setCount] = useState(streaming ? 0 : target.length);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    // No animation when not streaming or motion is reduced — the render below
    // derives the full text directly, so there's nothing to advance here.
    if (!streaming || reduceMotion) return;
    const tick = (now: number) => {
      const last = lastRef.current ?? now;
      lastRef.current = now;
      const dt = Math.min(now - last, 120); // clamp gaps (backgrounded tab)
      setCount((current) => {
        const remaining = target.length - current;
        if (remaining <= 0) return Math.min(current, target.length); // clamp on reset
        // Reveal faster when the backlog is larger so a ~1.5s chunk catches up in
        // well under a second of smooth typing, then settles to a calm cadence.
        const cps = Math.max(45, remaining * 5);
        const advance = Math.max(1, Math.round((cps * dt) / 1000));
        return Math.min(target.length, current + advance);
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      lastRef.current = null;
    };
  }, [streaming, reduceMotion, target]);

  const revealed = streaming && !reduceMotion ? Math.min(count, target.length) : target.length;
  return target.slice(0, revealed);
}

/** Flatten a rendered markdown node back to its raw text (for the copy button). */
function nodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: React.ReactNode }).children);
  return "";
}

/** A fenced code block with a language label and a copy button — the premium
 *  code affordance. Tokens are highlighted by `rehype-highlight` into `.hljs-*`
 *  spans; the palette (see `.arc-code .hljs-*` in arc.css) is a restrained
 *  gold/green/ivory reading of the obsidian system — no rainbow. `children` is the
 *  highlighted span tree; `raw` flattens it back to source for the copy button. */
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeChild = Array.isArray(children) ? children.find((child) => isValidElement(child)) : children;
  const className = isValidElement(codeChild) ? String((codeChild.props as { className?: string }).className ?? "") : "";
  const language = /language-([\w+-]+)/.exec(className)?.[1] ?? "";
  const raw = nodeText(children).replace(/\n$/, "");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };
  return (
    <div className="arc-code">
      <div className="arc-code-head">
        <span>{language || "code"}</span>
        <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy code"}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/** Shared markdown component overrides — rich code blocks and scroll-safe tables.
 *  Used by every Arc markdown surface so answers, streaming text, and reasoning
 *  all render the same way. */
export const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="arc-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

type MarkdownPlugins = React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

export const REMARK_PLUGINS: MarkdownPlugins = [remarkGfm];

// A curated language set for the highlighter — the snippets Arc actually shows
// (config, API payloads, shell, queries). Keeping the registry small keeps the
// bundle lean and, with `detect: false`, an unknown or unlabeled fence stays calm
// plain mono instead of being auto-guessed and mis-colored.
const HLJS_LANGUAGES = {
  bash, sh: bash, shell: bash, zsh: bash,
  css,
  javascript, js: javascript, jsx: javascript,
  json,
  python, py: python,
  sql,
  typescript, ts: typescript, tsx: typescript,
  xml, html: xml,
  yaml, yml: yaml,
};

// Highlight only when the code has settled — during streaming the fence is often
// incomplete, so re-tokenizing every frame both churns and mis-colors. Settled
// renders pass this; the streaming pass omits it and shows clean mono until done.
export const REHYPE_HIGHLIGHT_PLUGINS: MarkdownPlugins = [[rehypeHighlight, { detect: false, languages: HLJS_LANGUAGES }]];

/** Markdown that types itself out while `streaming`, with a trailing caret (the
 *  caret is a CSS `::after` on the last rendered block — see `.arc-stream`). */
export function StreamingMarkdown({ text, streaming, className }: { text: string; streaming: boolean; className?: string }) {
  const shown = useSmoothStream(text, streaming);
  return (
    <div className={`arc-stream${streaming ? " is-streaming" : ""}${className ? ` ${className}` : ""}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={streaming ? undefined : REHYPE_HIGHLIGHT_PLUGINS} components={MARKDOWN_COMPONENTS}>{shown}</ReactMarkdown>
    </div>
  );
}

/**
 * Arc's reply. One container and one type scale from the first streamed token
 * through to the settled message — finishing a run only drops the caret and lets
 * the syntax highlighter run.
 *
 * This exists because the answer used to be rendered twice: once inside the run
 * trace as small muted commentary while streaming, then again in a separate
 * result card once complete. The text changed size, colour, and position at the
 * moment of completion, which read as the message being replaced rather than
 * finishing. Every surface that shows an Arc reply — live, settled, or demo —
 * renders it through here so that can't drift apart again.
 */
export function ArcAnswer({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text.trim()) return null;
  return <StreamingMarkdown className="arc-answer-body arc-markdown" text={text} streaming={streaming} />;
}

/** The live "Thinking" stream — reasoning as it forms, kept in a calm fixed-height
 *  window that auto-scrolls to the newest line so a long transcript never sprawls.
 *  Snaps to full (no caret) once the answer starts. */
export function LiveReasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = useSmoothStream(text, streaming);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);
  return (
    <div className="arc-live-reasoning">
      <div className="arc-live-reasoning-scroll" ref={scrollRef}>
        <div className={`arc-stream${streaming ? " is-streaming" : ""} arc-markdown`}>
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{shown}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
