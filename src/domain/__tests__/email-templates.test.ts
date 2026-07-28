import { describe, expect, it } from "vitest";

import { renderAuthEmail, renderBrandedEmail } from "@/domain";

const theme = { appName: "Summit", logoUrl: "https://cdn.example.com/logo.png", accentColor: "#0B0B0C" };

describe("renderBrandedEmail", () => {
  it("renders heading, body paragraphs, and a CTA button in the html", () => {
    const { html } = renderBrandedEmail({
      heading: "Join Summit",
      bodyBlocks: ["You've been invited.", "Click below to accept."],
      cta: { label: "Accept invitation", url: "https://app.example.com/auth/confirm?code=abc" },
      theme,
    });
    expect(html).toContain("Join Summit");
    expect(html).toContain("You&#39;ve been invited.");
    expect(html).toContain("Click below to accept.");
    expect(html).toContain('href="https://app.example.com/auth/confirm?code=abc"');
    expect(html).toContain("Accept invitation");
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it("produces a plaintext alternative with the CTA url spelled out", () => {
    const { text } = renderBrandedEmail({
      heading: "Join Summit",
      bodyBlocks: ["You've been invited."],
      cta: { label: "Accept invitation", url: "https://app.example.com/x" },
      theme,
    });
    expect(text).toContain("Join Summit");
    expect(text).toContain("You've been invited.");
    expect(text).toContain("Accept invitation: https://app.example.com/x");
  });

  it("escapes html in body content and omits the logo + button when not provided", () => {
    const { html } = renderBrandedEmail({
      heading: "Hi <there>",
      bodyBlocks: ["A & B <script>"],
      theme: { appName: "Summit", accentColor: "#0B0B0C" },
    });
    expect(html).toContain("Hi &lt;there&gt;");
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
  });

  it("includes footerNote in both html and text when provided", () => {
    const { html, text } = renderBrandedEmail({
      heading: "Hi",
      bodyBlocks: ["Body."],
      theme: { appName: "Summit", accentColor: "#0B0B0C" },
      footerNote: "Sent by Summit.",
    });
    expect(html).toContain("Sent by Summit.");
    expect(text).toContain("Sent by Summit.");
  });

  it("ignores a non-hex accentColor (no CSS injection)", () => {
    const { html } = renderBrandedEmail({
      heading: "Hi",
      bodyBlocks: ["Body."],
      cta: { label: "Go", url: "https://x.test" },
      theme: { appName: "Summit", accentColor: "red;}body{display:none" },
    });
    expect(html).not.toContain("display:none");
    expect(html).toContain("#0B0B0C");
  });
});

describe("renderAuthEmail", () => {
  const base = {
    heading: "Confirm your email",
    preheader: "One click and your workspace is ready.",
    bodyBlocks: ["Confirm this address to finish creating your workspace."],
    cta: { label: "Confirm my email", url: "{{ .ConfirmationURL }}" },
    metaNote: "This link expires in 24 hours.",
    footerNote: "Sent by Arc Studio.",
    appName: "Arc Studio",
    logoUrl: "https://arc-studio.ai/icon.png",
  };

  it("leaves Supabase Go-template placeholders untouched through escaping", () => {
    const { html } = renderAuthEmail(base);
    // A mangled placeholder ships a dead link to every new signup, so assert the
    // exact literal rather than a loose substring.
    expect(html).toContain('href="{{ .ConfirmationURL }}"');
    expect(html).not.toContain("&#123;");
    expect(html).not.toContain("&amp;");
  });

  it("renders the preheader hidden so it previews in the inbox but not in the body", () => {
    const { html } = renderAuthEmail(base);
    expect(html).toContain("One click and your workspace is ready.");
    expect(html).toContain("display:none");
  });

  it("includes a copy/paste fallback link for clients that strip the button", () => {
    const { html } = renderAuthEmail(base);
    expect(html).toContain("Or paste this link into your browser");
  });

  it("escapes untrusted copy", () => {
    const { html } = renderAuthEmail({ ...base, heading: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("produces a plaintext alternative carrying the link", () => {
    const { text } = renderAuthEmail(base);
    expect(text).toContain("Confirm your email");
    expect(text).toContain("Confirm my email: {{ .ConfirmationURL }}");
    expect(text).toContain("Sent by Arc Studio.");
  });

  it("falls back to a text mark when no logo URL is supplied", () => {
    const { html } = renderAuthEmail({ ...base, logoUrl: null });
    expect(html).not.toContain("<img");
    expect(html).toContain("Arc Studio");
  });
});
