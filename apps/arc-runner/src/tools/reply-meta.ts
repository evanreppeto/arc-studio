import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcMention, ArcQuestion } from "../types";
import { textResult } from "./helpers";

/** Propose 1–4 follow-up prompts; the app renders them as clickable chips. */
export function suggestFollowupsTool(addSuggestion: (text: string) => void) {
  return tool(
    "suggest_followups",
    "Offer 1–4 short, concrete next-step prompts the operator can tap to continue (e.g. 'Draft an SMS variant', 'Find more flood-zone landlords'). Call once near the end of your reply.",
    { prompts: z.array(z.string()).describe("1–4 short next-step prompts") },
    async (args) => {
      const kept = args.prompts.map((p) => p.trim()).filter(Boolean).slice(0, 4);
      for (const p of kept) addSuggestion(p);
      return textResult(`Suggested ${kept.length} follow-up(s).`);
    },
    // Never deferred behind tool search: see ALWAYS_LOADED_REPLY_TOOLS in ./index.
    { alwaysLoad: true },
  );
}

/** Record the CRM/brain/campaign records you used; they render as "Sources Arc used". */
export function citeSourcesTool(addSource: (mention: ArcMention) => void) {
  return tool(
    "cite_sources",
    "Cite the records you used to answer (leads, companies, contacts, campaigns, etc.) so the operator sees your sources. Provide each as { type, id, label, href } using the record's real id and a link like /crm/leads/<id> or /campaigns/<id>.",
    {
      sources: z
        .array(
          z.object({
            type: z.string().describe("lead | company | contact | property | job | outcome | campaign | persona"),
            id: z.string(),
            label: z.string(),
            href: z.string(),
          }),
        )
        .describe("The records you referenced"),
    },
    async (args) => {
      for (const s of args.sources) addSource({ type: s.type, id: s.id, label: s.label, href: s.href });
      return textResult(`Cited ${args.sources.length} source(s).`);
    },
    // Never deferred behind tool search: see ALWAYS_LOADED_REPLY_TOOLS in ./index.
    { alwaysLoad: true },
  );
}

/**
 * Ask the operator a structured question — the app renders it as an interactive
 * panel above the composer (option chips / checkboxes / free text), and the
 * operator's choice auto-sends as their next message. Use this INSTEAD of writing
 * a plain-text question with options when you genuinely need the operator to
 * decide; keep your reply body short since the panel shows the choices.
 */
export function askOperatorTool(addQuestion: (question: ArcQuestion) => void) {
  return tool(
    "ask_operator",
    "Ask the operator a question with selectable options instead of writing it as prose. Renders as clickable chips above the composer; tapping one auto-sends it as their answer. Provide a short `prompt` and `options` (the choices). Set `multi: true` to let them pick several, and `allow_text: true` to also offer a free-text answer. Only use when you genuinely need their decision — otherwise infer a sensible default and proceed. Keep your reply body brief; don't repeat the options in prose.",
    {
      prompt: z.string().describe("The question to ask"),
      options: z.array(z.string()).optional().describe("Selectable choices (omit for a free-text-only question)"),
      multi: z.boolean().optional().describe("Allow selecting several options at once"),
      allow_text: z.boolean().optional().describe("Also offer a free-text 'type your own' answer"),
    },
    async (args) => {
      const options = (args.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 8);
      const allowText = args.allow_text === true;
      if (options.length === 0 && !allowText) {
        return textResult("ask_operator needs at least one option or allow_text:true.");
      }
      addQuestion({
        id: `q${Date.now().toString(36)}`,
        prompt: args.prompt,
        options,
        multi: args.multi === true,
        allowText,
      });
      return textResult(`Asked the operator: ${args.prompt}`);
    },
  );
}
