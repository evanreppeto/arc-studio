"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { type ActivationChecklist, type ActivationStepKey } from "@/domain";

import { dismissSetupChecklistAction } from "../actions";

/**
 * First-run setup checklist.
 *
 * A new workspace is created with default media folders and a persona pack and
 * nothing else — no contacts, no companies, no campaigns. So the pitch ("Arc
 * watches your records and finds opportunities") has nothing to watch, and a new
 * owner lands on an empty app with no idea what to do. This is what tells them.
 *
 * The copy leads with WHY each step matters rather than naming a feature: an
 * owner who doesn't know what the product needs won't be persuaded by "Add
 * media". `records` is marked blocking because until it's done every other
 * screen stays empty regardless.
 */

const STEP_COPY: Record<ActivationStepKey, { title: string; why: string; cta: string; href: string }> = {
  records: {
    title: "Bring in your records",
    why: "Arc works from your contacts and companies. Until there are some, it has nothing to search and every screen stays empty.",
    cta: "Add records",
    href: "/crm",
  },
  brand: {
    title: "Teach Arc your brand",
    why: "Point it at your website and it learns your voice, services and proof points — so drafts sound like you instead of generic marketing.",
    cta: "Set up brand",
    href: "/brand",
  },
  opportunity: {
    title: "See what Arc found",
    why: "Arc scans your records and files opportunities with the evidence attached. This is the first sign it is working for you.",
    cta: "Open the inbox",
    href: "/opportunities",
  },
  campaign: {
    title: "Approve your first campaign",
    why: "Arc drafts every asset — email, copy, creative — and waits. Nothing reaches a customer until you approve it, and this step stays open until you have.",
    cta: "See campaigns",
    href: "/campaigns",
  },
  media: {
    title: "Add your real photos",
    why: "Approved photos of your actual work outperform anything generated. Arc will use them wherever it can.",
    cta: "Open library",
    href: "/library",
  },
  team: {
    title: "Invite a teammate",
    why: "Approvals are easier when someone else can cover them.",
    cta: "Invite",
    href: "/settings",
  },
};

export function SetupChecklist({ checklist }: { checklist: ActivationChecklist }) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!checklist.showChecklist || hidden) return null;

  const doneCount = checklist.steps.filter((s) => s.done).length;
  const total = checklist.steps.length;

  function dismiss() {
    // Hide immediately — waiting on a round-trip to acknowledge a dismissal
    // makes the panel feel stuck. The write is best-effort; if it fails the
    // panel returns on next load, which is the safe direction.
    setHidden(true);
    startTransition(() => {
      void dismissSetupChecklistAction();
    });
  }

  return (
    <div className="setup">
      <div className="setup-h">
        <div>
          <div className="lab">Get set up</div>
          <p className="setup-sub">
            {checklist.coreDone
              ? "Arc has records to work from. These make its drafts better."
              : "Arc needs a few things before it can find work for you."}
          </p>
        </div>
        <div className="setup-meta">
          <span className="setup-count">
            {doneCount}/{total}
          </span>
          <button type="button" className="setup-x" onClick={dismiss} disabled={pending} aria-label="Dismiss setup checklist">
            Dismiss
          </button>
        </div>
      </div>

      <ol className="setup-steps">
        {checklist.steps.map((step) => {
          const copy = STEP_COPY[step.key];
          const isNext = !step.done && checklist.nextStep === step.key;
          return (
            <li key={step.key} className={`setup-step${step.done ? " done" : ""}${isNext ? " next" : ""}`}>
              <span className="setup-tick" aria-hidden>
                {step.done ? (
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </span>
              <div className="setup-body">
                <div className="setup-title">
                  {copy.title}
                  {step.blocking && !step.done && <span className="setup-req">Required</span>}
                </div>
                {!step.done && <p className="setup-why">{copy.why}</p>}
              </div>
              {!step.done && (
                <Link className={isNext ? "btn" : "btn ghost"} href={copy.href}>
                  {copy.cta}&nbsp;→
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
