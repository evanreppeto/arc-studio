"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * Track whether the reader is pinned to the bottom of a scroll container, so a
 * stream can follow along without ever yanking someone who scrolled up to read.
 *
 * Wheel and touch are the fast-path intent signals; the scroll listener
 * additionally unpins on any UPWARD movement we didn't initiate, which is the
 * only way to catch scrollbar drags, keyboard scrolling, and assistive tech.
 * Content growth and our own bottom-follow can only move scrollTop toward larger
 * values, so streamed content never trips the upward check. Returning to the
 * bottom re-pins.
 *
 * Extracted from the conversation feed, which had this right, so that every
 * auto-following surface in Arc gets the same behavior. The live reasoning
 * window notably did not: it drove `scrollTop = scrollHeight` on every revealed
 * frame — roughly sixty times a second — so a reader could watch thinking
 * happen but could not scroll back a single line while it did.
 *
 * `guard()` opens a short window in which upward movement counts as ours rather
 * than the reader's, for deliberate programmatic jumps to the top.
 */
export function useBottomPin(
  ref: RefObject<HTMLElement | null>,
  { threshold = 48 }: { threshold?: number } = {},
) {
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const lastScrollTopRef = useRef(0);
  const guardUntilRef = useRef(0);

  const guard = useCallback((ms = 400) => {
    guardUntilRef.current = performance.now() + ms;
  }, []);

  const repin = useCallback(() => {
    pinnedRef.current = true;
    setPinned(true);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;
    // Tight threshold so a deliberate scroll-up reliably breaks the follow (and
    // isn't immediately re-pinned) — you re-pin only by returning to the bottom.
    const nearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    const unpin = () => {
      if (pinnedRef.current) {
        pinnedRef.current = false;
        setPinned(false);
      }
    };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) unpin(); };
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? 0;
      if (y - touchY > 6) unpin();
      touchY = y;
    };
    const onScroll = () => {
      const top = el.scrollTop;
      const previous = lastScrollTopRef.current;
      lastScrollTopRef.current = top;
      if (nearBottom()) {
        pinnedRef.current = true;
        setPinned(true); // no-op re-render when already pinned
        return;
      }
      if (top < previous - 1 && performance.now() > guardUntilRef.current) unpin();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref, threshold]);

  return { pinned, pinnedRef, guard, repin };
}
