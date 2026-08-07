"use client";

import { useEffect, useState } from "react";

type Tone = "polite" | "assertive";
type Listener = (message: string, tone: Tone) => void;

const listeners = new Set<Listener>();

/**
 * Say something to a screen reader.
 *
 * The app already renders plenty of `role="status"` text, and most of it is
 * fine. What it did not have is a region that is ALREADY IN THE DOM when the
 * message arrives. A live region that mounts and fills in the same commit is
 * unreliable — several screen readers only announce changes to a region they
 * were already observing, so `{status ? <div role="status">…</div> : null}`
 * announces on some setups and silently does nothing on others. That pattern is
 * how Settings' save confirmations were written, in 19 places.
 *
 * This is the other half: two regions mounted once for the life of the shell,
 * whose text changes. Callers keep rendering whatever they render visually — the
 * announcement is a separate channel, so nothing about the layout changes.
 *
 * `polite` waits for a pause (a save landed, a draft was approved). `assertive`
 * interrupts, and is for failures the operator has to know about before they do
 * anything else. Default to polite; assertive is a cost paid by the listener.
 */
export function announce(message: string, tone: Tone = "polite"): void {
  const text = message.trim();
  if (!text) return;
  for (const listener of listeners) listener(text, tone);
}

/**
 * Mounted once, in the shell. Two regions rather than one because `polite` and
 * `assertive` are different queues — sharing a node would let a routine "Saved"
 * cancel an error that is still being read out.
 */
export function Announcer() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  useEffect(() => {
    const listener: Listener = (message, tone) => {
      // A screen reader announces a CHANGE. Posting the same string twice leaves
      // the DOM identical, so the second one is silent — "Couldn't save" twice
      // in a row would be read once. The zero-width space alternates to force a
      // real mutation, and is not spoken.
      const bump = (previous: string) => (previous.endsWith("​") ? message : `${message}​`);
      if (tone === "assertive") setAssertive(bump);
      else setPolite(bump);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </>
  );
}
