import { describe, expect, it } from "vitest";

import { applyFileNameStem, classifyKind, formatByteSize, splitFileName } from "../media-library";

describe("classifyKind", () => {
  it("classifies images, video, and svg logos", () => {
    expect(classifyKind("image/png", "before.png")).toBe("image");
    expect(classifyKind("image/jpeg", "site.jpg")).toBe("image");
    expect(classifyKind("video/mp4", "flyover.mp4")).toBe("video");
    expect(classifyKind("image/svg+xml", "logo.svg")).toBe("logo");
    expect(classifyKind("application/pdf", "one-pager.pdf")).toBe("document");
  });

  it("classifies text and docx as document", () => {
    expect(classifyKind("text/plain", "notes.txt")).toBe("document");
    expect(classifyKind("text/markdown", "kb.md")).toBe("document");
    expect(
      classifyKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "guide.docx"),
    ).toBe("document");
  });
});

describe("formatByteSize", () => {
  it("formats bytes to human units", () => {
    expect(formatByteSize(2_100_000)).toBe("2.1 MB");
    expect(formatByteSize(14_000_000)).toBe("14 MB");
    expect(formatByteSize(900)).toBe("900 B");
  });
});

describe("splitFileName", () => {
  it("splits a normal filename into stem and extension", () => {
    expect(splitFileName("photo.jpg")).toEqual({ stem: "photo", ext: ".jpg" });
    expect(splitFileName("one-pager.pdf")).toEqual({ stem: "one-pager", ext: ".pdf" });
  });
  it("uses the last dot for multi-dotted names", () => {
    expect(splitFileName("archive.tar.gz")).toEqual({ stem: "archive.tar", ext: ".gz" });
  });
  it("treats names with no extension as all-stem", () => {
    expect(splitFileName("README")).toEqual({ stem: "README", ext: "" });
  });
  it("does not treat a leading dot (dotfile) as an extension", () => {
    expect(splitFileName(".gitignore")).toEqual({ stem: ".gitignore", ext: "" });
  });
  it("does not treat a trailing dot as an extension", () => {
    expect(splitFileName("photo.")).toEqual({ stem: "photo.", ext: "" });
  });
});

describe("applyFileNameStem", () => {
  it("re-appends the original extension to a new stem", () => {
    expect(applyFileNameStem("photo.jpg", "sunset")).toBe("sunset.jpg");
  });
  it("preserves extension-less names", () => {
    expect(applyFileNameStem("README", "NOTES")).toBe("NOTES");
  });
  it("trims surrounding whitespace from the new stem", () => {
    expect(applyFileNameStem("photo.jpg", "  sunset  ")).toBe("sunset.jpg");
  });
  it("returns the original name when the new stem is empty", () => {
    expect(applyFileNameStem("photo.jpg", "   ")).toBe("photo.jpg");
  });
  it("does not double up the extension when the stem already carries it", () => {
    expect(applyFileNameStem("photo.jpg", "new.jpg")).toBe("new.jpg");
    expect(applyFileNameStem("photo.JPG", "new.jpg")).toBe("new.jpg");
  });
});
