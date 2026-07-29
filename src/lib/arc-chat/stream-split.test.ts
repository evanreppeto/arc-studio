import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { splitStreamedMarkdown } from "./stream-split";

/** Reassembling the two halves must always give back the original document —
 *  the split is an optimisation, never an edit. */
function rejoin(text: string) {
  const { settled, tail } = splitStreamedMarkdown(text);
  return settled ? `${settled}\n\n${tail}` : tail;
}

describe("splitStreamedMarkdown", () => {
  it("settles completed paragraphs and leaves the one being written in the tail", () => {
    const { settled, tail } = splitStreamedMarkdown("First paragraph.\n\nSecond one, still bei");

    expect(settled).toBe("First paragraph.");
    expect(tail).toBe("Second one, still bei");
  });

  it("keeps everything in the tail until a block has actually completed", () => {
    expect(splitStreamedMarkdown("Only one partial para")).toEqual({ settled: "", tail: "Only one partial para" });
  });

  it("advances the boundary only forward as more text arrives", () => {
    const growing = ["A.", "A.\n\nB", "A.\n\nB.", "A.\n\nB.\n\nC", "A.\n\nB.\n\nC."];
    const settledLengths = growing.map((text) => splitStreamedMarkdown(text).settled.length);

    expect(settledLengths).toEqual([0, 2, 2, 6, 6]); // "", "A.", "A.", "A.\n\nB.", "A.\n\nB."
    // Monotonic: the memoized prefix must never shrink, or it would re-render.
    expect([...settledLengths].sort((a, b) => a - b)).toEqual(settledLengths);
  });

  // The bug a naive "split on the last blank line" would cause: a loose list
  // parsed as two documents becomes two lists, and an ordered one restarts at 1.
  it("never splits a loose list across the boundary", () => {
    const loose = "Here they are:\n\n1. First\n\n2. Second\n\n3. Thir";
    const { settled, tail } = splitStreamedMarkdown(loose);

    expect(settled).toBe("Here they are:");
    expect(tail).toBe("1. First\n\n2. Second\n\n3. Thir");
  });

  it.each([
    ["bulleted", "- one\n\n- two\n\n- thr"],
    ["blockquote", "> one\n\n> two\n\n> thr"],
    ["table", "| a | b |\n\n| - | - |\n\n| 1 | 2"],
    ["indented continuation", "- item\n\n  continued\n\n  mor"],
  ])("keeps a %s construct whole", (_label, text) => {
    expect(splitStreamedMarkdown(text).settled).toBe("");
  });

  it("does not split inside a fenced code block", () => {
    const text = "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n";
    const { settled, tail } = splitStreamedMarkdown(text);

    expect(settled).toBe("Intro.");
    expect(tail).toContain("```ts");
    expect(tail).toContain("const b = 2;");
  });

  it("settles a closed fence and moves on to the next block", () => {
    const text = "```ts\nconst a = 1;\n```\n\nAfter the code, still writ";
    const { settled, tail } = splitStreamedMarkdown(text);

    expect(settled).toBe("```ts\nconst a = 1;\n```");
    expect(tail).toBe("After the code, still writ");
  });

  it("does not settle on trailing blank lines — the tail must keep a block for the caret", () => {
    expect(splitStreamedMarkdown("A finished paragraph.\n\n")).toEqual({
      settled: "",
      tail: "A finished paragraph.\n\n",
    });
  });

  // A heading is complete the moment its line ends, and a list starting after it
  // is a fresh construct — so the cut goes between them, not before the heading.
  it("settles a heading and starts the tail at the list beneath it", () => {
    const { settled, tail } = splitStreamedMarkdown("Intro line.\n\n## Next steps\n\n- do the thing");

    expect(settled).toBe("Intro line.\n\n## Next steps");
    expect(tail).toBe("- do the thing");
  });

  it.each([
    "",
    "\n\n",
    "A.\n\nB.",
    "Intro.\n\n```ts\nx\n```\n\nOutro text.",
    "One.\n\n- a\n- b\n\nTwo, in progress",
  ])("round-trips without changing the document (%j)", (text) => {
    expect(rejoin(text).replace(/\s+$/, "")).toBe(text.replace(/\s+$/, ""));
  });
});

/**
 * The property that actually matters: rendering the two halves as separate
 * documents must produce exactly the HTML that rendering the whole document
 * produces. If a boundary ever lands inside a construct this fails — which is
 * the bug the conservative rules above exist to prevent.
 */
describe("splitStreamedMarkdown renders identically to the undivided document", () => {
  // react-markdown joins top-level blocks with a newline text node. Rendering
  // the halves separately loses that one join, which changes nothing about the
  // markup — the elements are block-level and React renders both halves as
  // siblings anyway. Normalise only that exact case (a single newline directly
  // between two tags); whitespace inside <pre> never matches this shape.
  const render = (md: string) =>
    renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md)).replace(/>\n</g, "><");

  const documents = [
    "Plain paragraph.\n\nAnother paragraph.\n\nA third being writ",
    "Intro.\n\n## A heading\n\n- tight one\n- tight two\n\nClosing par",
    "Lead in:\n\n1. First\n\n2. Second\n\n3. Third, loose list",
    "Before.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter the fence",
    "Text.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nTrailing par",
    "Quote:\n\n> line one\n> line two\n\nAnd on we go",
    "A **bold** claim.\n\n- item with `code`\n- item with [a link](https://example.test)\n\nEnd",
  ];

  it.each(documents)("%j", (doc) => {
    const { settled, tail } = splitStreamedMarkdown(doc);
    const split = settled ? render(settled) + render(tail) : render(tail);
    expect(split).toBe(render(doc));
  });

  // Every intermediate frame of a stream, not just the final document.
  it("holds at every frame of a streamed reply", () => {
    const doc = documents[1]!;
    let framesThatActuallySplit = 0;
    for (let cut = 1; cut <= doc.length; cut += 1) {
      const frame = doc.slice(0, cut);
      const { settled, tail } = splitStreamedMarkdown(frame);
      if (settled) framesThatActuallySplit += 1;
      const split = settled ? render(settled) + render(tail) : render(tail);
      expect(split, `frame ending at ${cut}: ${JSON.stringify(frame.slice(-20))}`).toBe(render(frame));
    }
    // Guard against a vacuous pass: if nothing ever settled, the loop above
    // would only be comparing the undivided document against itself.
    expect(framesThatActuallySplit).toBeGreaterThan(doc.length / 2);
  });
});
