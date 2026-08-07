"use client";

// The Arc chat's markdown + streaming engine, factored out so answers, streamed
// text, and reasoning all render identically wherever they appear. Self-contained:
// depends only on react-markdown / highlight.js / motion — no other arc component —
// so both the live and demo conversation renderers import from here.

import { isValidElement, memo, useEffect, useRef, useState } from "react";
import { ArrowDown, Check, Copy } from "lucide-react";
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

import { revealAdvance } from "@/lib/arc-chat/stream-reveal";
import { splitStreamedMarkdown } from "@/lib/arc-chat/stream-split";

import { useBottomPin } from "./use-bottom-pin";

/**
 * Smoothly reveal streamed text.
 *
 * Text does not arrive token by token: the runner writes partial reply bodies to
 * the database and the SSE route polls it — every 120ms while a run is active,
 * relaxing to 500ms when nothing is changing (see
 * `app/api/arc/stream/[conversationId]/route.ts`). So the client still receives
 * visible chunks, and without smoothing the answer lands in steps.
 *
 * The pacing itself lives in `@/lib/arc-chat/stream-reveal` — it is the part
 * worth testing, and it is tested against the cadences the SSE route actually
 * delivers. This hook is just the animation loop around it.
 */
export function useSmoothStream(target: string, streaming: boolean): string {
  const reduceMotion = useReducedMotion();
  const [count, setCount] = useState(streaming ? 0 : target.length);
  const countRef = useRef(count);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduceMotion) return;
    // Keep animating while text is still arriving OR while we are behind — the
    // second half is what lets a finished run settle instead of snapping.
    if (!streaming && countRef.current >= target.length) return;
    const tick = (now: number) => {
      const last = lastRef.current ?? now;
      lastRef.current = now;
      const dt = Math.min(now - last, 120); // clamp gaps (backgrounded tab)
      setCount((current) => {
        const remaining = target.length - current;
        if (remaining <= 0) {
          countRef.current = Math.min(current, target.length);
          return countRef.current; // clamp on reset
        }
        countRef.current = Math.min(target.length, current + revealAdvance(remaining, dt, streaming));
        return countRef.current;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // Guarantee the end state without depending on rAF.
    //
    // Animating the settle instead of snapping to full removed the dump at the
    // end of a reply — but it also made completion conditional on frames being
    // delivered. A backgrounded tab stops delivering them, so a finished reply
    // sat truncated (149 characters of 2,563, observed on prod) until the tab
    // was looked at again. The animation is a nicety; arriving is not.
    const settleGuard = streaming
      ? null
      : window.setTimeout(() => {
          countRef.current = target.length;
          setCount(target.length);
        }, 1200);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (settleGuard != null) window.clearTimeout(settleGuard);
      lastRef.current = null;
    };
  }, [streaming, reduceMotion, target]);

  const revealed = reduceMotion ? target.length : Math.min(count, target.length);
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

/**
 * Blocks that are done arriving. Memoized on the exact markdown string, so once
 * a block has settled it is never re-parsed again for the rest of the stream —
 * the reveal loop then only pays for the paragraph still being written.
 *
 * react-markdown renders its blocks directly (no wrapper element), so splitting
 * the reply across two of these leaves the same flat run of children under
 * `.arc-stream` — the markup is identical to rendering it undivided.
 */
const SettledBlocks = memo(function SettledBlocks({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>;
});

/** Markdown that types itself out while `streaming`, with a trailing caret (the
 *  caret is a CSS `::after` on the last rendered block — see `.arc-stream`). */
export function StreamingMarkdown({ text, streaming, className }: { text: string; streaming: boolean; className?: string }) {
  const shown = useSmoothStream(text, streaming);
  // Settled once the run ends: one root, and the syntax highlighter finally runs
  // over the whole reply. While streaming, only the tail is re-parsed per frame.
  const { settled, tail } = streaming ? splitStreamedMarkdown(shown) : { settled: "", tail: shown };
  return (
    <div className={`arc-stream${streaming ? " is-streaming" : ""}${className ? ` ${className}` : ""}`}>
      {settled ? <SettledBlocks text={settled} /> : null}
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={streaming ? undefined : REHYPE_HIGHLIGHT_PLUGINS} components={MARKDOWN_COMPONENTS}>{tail}</ReactMarkdown>
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

/**
 * Reasoning, rendered the same way everywhere it appears — streaming live, or
 * re-read later from a collapsed run receipt or the Work panel.
 *
 * It used to be markdown only while live. The two settled surfaces dumped the
 * same string into a bare `<p>`, so the moment a run finished, reasoning the
 * reader was mid-way through turned into literal `**asterisks**`, `-` bullets,
 * and `##` hashes. Every surface goes through here now so they can't drift.
 */
export function ReasoningMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  // Reasoning streams on the same per-frame reveal as the answer, so it gets the
  // same treatment: settled blocks are memoized, only the tail is re-parsed.
  const { settled, tail } = streaming ? splitStreamedMarkdown(text) : { settled: "", tail: text };
  return (
    <div className={`arc-reasoning-body arc-stream${streaming ? " is-streaming" : ""} arc-markdown`}>
      {settled ? <SettledBlocks text={settled} /> : null}
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{tail}</ReactMarkdown>
    </div>
  );
}

/**
 * The live "Thinking" stream — reasoning as it forms.
 *
 * Follows the newest line only while the reader is actually at the bottom. It
 * used to set `scrollTop = scrollHeight` on every revealed frame, which meant
 * any attempt to scroll back was overridden within ~16ms: you could watch the
 * thinking, but you could not read it. The window is also expandable now — a
 * long reasoning pass through a ~5-line porthole is not something to make
 * someone squint at.
 */
export function LiveReasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = useSmoothStream(text, streaming);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  /**
   * Whether there is anything above the visible window.
   *
   * The porthole's top fade used to be unconditional, so the first line of a run
   * — the one moment someone is actually watching the thinking form — was
   * rendered half-transparent by a gradient whose whole job is to say "there is
   * more above this". A partial first sentence under a fade reads as a broken
   * render, not as a stream. The fade is a claim about the content, so it is
   * only made when the content backs it up.
   */
  const [scrolledPast, setScrolledPast] = useState(false);
  /** Whether the window is actually clipping anything, which is the only state
   *  in which "Expand thinking" has something to reveal. */
  const [overflowing, setOverflowing] = useState(false);
  const { pinned, pinnedRef, repin } = useBottomPin(scrollRef, { threshold: 24 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    setScrolledPast(el.scrollTop > 1);
    setOverflowing(el.scrollHeight - el.clientHeight > 1);
  }, [shown, expanded, pinnedRef]);

  const followLatest = () => {
    repin();
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  return (
    <div className="arc-live-reasoning" data-expanded={expanded ? "true" : undefined}>
      <div
        className="arc-live-reasoning-scroll"
        ref={scrollRef}
        data-clipped={scrolledPast ? "true" : undefined}
        onScroll={(event) => setScrolledPast(event.currentTarget.scrollTop > 1)}
      >
        <ReasoningMarkdown text={shown} streaming={streaming} />
      </div>
      {overflowing || expanded ? (
        <div className="arc-live-reasoning-controls">
          <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {expanded ? "Collapse thinking" : "Expand thinking"}
          </button>
          {!pinned ? (
            <button type="button" className="is-follow" onClick={followLatest}>
              <ArrowDown size={11} /> Follow latest
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
