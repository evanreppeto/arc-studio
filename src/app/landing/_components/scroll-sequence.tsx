"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";

const FRAME_COUNT = 120;
const frameSrc = (i: number) => `/brand/landing/sequence/frame-${String(i).padStart(3, "0")}.webp`;

const STAGES = [
  { from: 0.02, to: 0.3, text: "The agent does the work." },
  { from: 0.36, to: 0.62, text: "A human approves the decisions." },
  { from: 0.68, to: 0.96, text: "The database remembers everything." },
];

function StageLine({
  progress,
  from,
  to,
  text,
}: {
  progress: ReturnType<typeof useScroll>["scrollYProgress"];
  from: number;
  to: number;
  text: string;
}) {
  const fadeSpan = Math.min(0.08, (to - from) / 3);
  const opacity = useTransform(progress, [from, from + fadeSpan, to - fadeSpan, to], [0, 1, 1, 0]);
  const y = useTransform(progress, [from, from + fadeSpan], [26, 0]);
  return (
    <motion.p
      style={{ opacity, y }}
      className="absolute inset-x-6 text-center font-serif text-[1.9rem] font-medium leading-snug text-[var(--text-primary)] sm:text-[2.6rem]"
    >
      {text}
    </motion.p>
  );
}

// The scroll-scrubbed brand film: 120 frames (every source frame) from a
// Higgsfield-generated video of a gold ribbon drawing itself. The scrub is
// driven through a spring, so discrete mouse-wheel steps glide through the
// in-between frames instead of jumping. Reduced motion gets the finished
// frame and all three lines static.
export function ScrollSequence() {
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const currentFrame = useRef(-1);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });
  // Smooths chunky wheel/trackpad input into continuous motion before it
  // reaches the canvas and the stage copy.
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.5 });

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;

    const draw = (index: number) => {
      const canvas = canvasRef.current;
      const img = imagesRef.current[index];
      if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      currentFrame.current = index;
    };

    // Preload every frame; paint frame 0 as soon as it arrives.
    imagesRef.current = Array.from({ length: FRAME_COUNT }, (_, i) => {
      const img = new Image();
      img.src = frameSrc(i);
      if (i === 0) img.onload = () => !cancelled && currentFrame.current < 0 && draw(0);
      return img;
    });

    const unsubscribe = smoothProgress.on("change", (p) => {
      const index = Math.min(FRAME_COUNT - 1, Math.max(0, Math.round(p * (FRAME_COUNT - 1))));
      if (index !== currentFrame.current) draw(index);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      imagesRef.current = [];
    };
  }, [reduced, smoothProgress]);

  if (reduced) {
    return (
      <section className="relative border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
        <img
          src={frameSrc(FRAME_COUNT - 1)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-45"
          aria-hidden
        />
        <div className="relative mx-auto max-w-4xl space-y-8 px-6 py-14 sm:py-28 text-center">
          {STAGES.map((stage) => (
            <p
              key={stage.text}
              className="font-serif text-[1.9rem] font-medium leading-snug text-[var(--text-primary)]"
            >
              {stage.text}
            </p>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={containerRef} className="relative h-[120vh] sm:h-[300vh]" aria-label="How Arc operates">
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden border-y border-[color:var(--border-panel)] bg-[#0d0d10]">
        <canvas
          ref={canvasRef}
          width={1920}
          height={1080}
          className="absolute inset-0 h-full w-full object-cover"
          aria-hidden
        />
        {/* Legibility scrims over the film */}
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[var(--canvas)] to-transparent" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--canvas)] to-transparent" aria-hidden />
        <div className="relative flex h-24 w-full items-center justify-center">
          {STAGES.map((stage) => (
            <StageLine
              key={stage.text}
              progress={smoothProgress}
              from={stage.from}
              to={stage.to}
              text={stage.text}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
