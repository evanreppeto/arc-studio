"use client";

import { useRef, useState, useTransition } from "react";

import type { BrandProfileView } from "@/lib/brand-kit/profile-view";
import type { BrandKnowledgeSyncSummary } from "@/lib/brand-knowledge/sync-summary";

import { analyzeBrandWebsite, removeBrandLogo, resyncBrandSources, saveBrandLogo, updateBrandIdentity, uploadBrandDocuments, type BrandLogoResult, type BrandUploadResult, type BrandWebsiteAnalysis } from "../actions";
import { EditIdentityModal } from "./edit-identity-modal";

const STUDIO = "/studio";
const BRAIN = "/brain";

const CHECK = <svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6" /></svg>;
const BAN = <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></svg>;
const RESYNC = <svg viewBox="0 0 24 24"><path d="M4 4v6h6M20 20v-6h-6" /><path d="M20 10a8 8 0 00-14-3M4 14a8 8 0 0014 3" /></svg>;
const DOC = <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>;


// Mirrors the server-side gate (acceptUpload): the picker filters, the action
// re-validates. `.md`/`.csv` are extension-only because browsers rarely type
// them.
const DOC_ACCEPT = ".docx,.pdf,.md,.markdown,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Mirrors uploadBrandingImage's EXT map — the action re-checks type and size.
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

/** Relative luminance test so swatch text stays legible on any palette color. */
function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

export function BrandView({ view }: { view: BrandProfileView }) {
  const { identity, palette, tone, voiceGuidance, preferredPhrases, bannedPhrases, proofPoints, services, guardrails, sources } = view;
  const [active, setActive] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Brand document intake: one in-flight action at a time, one banner of its
  // result. `busy` covers both upload and re-sync so the UI can't fire twice.
  const fileInput = useRef<HTMLInputElement>(null);
  const [intake, startIntake] = useTransition();
  const [busy, setBusy] = useState<null | "upload" | "resync" | string>(null);
  const [syncSummary, setSyncSummary] = useState<BrandKnowledgeSyncSummary | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  function runIntake(kind: "upload" | "resync" | string, action: () => Promise<BrandUploadResult>) {
    setBusy(kind);
    setIntakeError(null);
    startIntake(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setSyncSummary(result.persisted ? result.summary : { ok: false, message: "Connect a workspace to learn from documents.", items: [] });
        } else {
          setIntakeError(result.error);
          setSyncSummary(null);
        }
      } catch {
        setIntakeError("Something went wrong. Try again.");
      } finally {
        setBusy(null);
      }
    });
  }

  // The workspace logo — one image, shared with the Settings control: it draws
  // in the nav rail AND is stamped on generated creative, so the preview here
  // reflects both.
  // Two pickers, not one shared picker plus a "who opened it" ref: each control
  // then carries its own origin, so the result reports itself in the right place
  // without mutating state from inside JSX.
  const logoInput = useRef<HTMLInputElement>(null);
  const cardLogoInput = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(identity.logoUrl);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  // WHERE the failure should be reported. The header button and the intake card
  // share one action, and an error rendered only in the header is off-screen for
  // someone who just dropped a file on the card further down the page.
  const [logoErrorAt, setLogoErrorAt] = useState<"header" | "card">("header");
  const [dragOverLogo, setDragOverLogo] = useState(false);
  const [, startLogo] = useTransition();

  function runLogo(action: () => Promise<BrandLogoResult>, from: "header" | "card" = "header") {
    setLogoBusy(true);
    setLogoError(null);
    setLogoErrorAt(from);
    startLogo(async () => {
      try {
        const result = await action();
        if (result.ok) setLogoUrl(result.url);
        else setLogoError(result.error);
      } catch {
        setLogoError("Something went wrong. Try again.");
      } finally {
        setLogoBusy(false);
      }
    });
  }

  function onLogoPicked(chosen: File | null, event: React.ChangeEvent<HTMLInputElement>, from: "header" | "card") {
    event.target.value = ""; // let the same file be re-picked after a remove
    if (!chosen) return;
    const formData = new FormData();
    formData.append("file", chosen);
    runLogo(() => saveBrandLogo(formData), from);
  }

  function onLogoRemove() {
    runLogo(() => removeBrandLogo());
  }

  /**
   * Drag-and-drop onto the logo card. Filters to images up front so dropping a
   * PDF fails here with a readable message instead of reaching the action and
   * coming back as a generic upload rejection — `uploadBrandingImage` accepts
   * only the LOGO_ACCEPT types, and it still re-checks type and size server-side.
   */
  function onLogoDropped(event: React.DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOverLogo(false);
    if (logoBusy) return;
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length === 0) return;
    const image = dropped.find((file) => LOGO_ACCEPT.includes(file.type));
    if (!image) {
      setLogoErrorAt("card");
      setLogoError("That file type isn't supported. Use a PNG, JPG, WebP, GIF or SVG.");
      return;
    }
    const formData = new FormData();
    formData.append("file", image);
    runLogo(() => saveBrandLogo(formData), "card");
  }

  // Website analysis. Read-only: it fetches the page and shows what it found;
  // nothing is saved until the operator acts on it.
  const websiteInput = useRef<HTMLInputElement>(null);
  const [analyzing, startAnalyze] = useTransition();
  const [analysis, setAnalysis] = useState<BrandWebsiteAnalysis | null>(null);

  function onAnalyze() {
    const url = websiteInput.current?.value ?? "";
    setAnalysis(null);
    startAnalyze(async () => {
      try {
        setAnalysis(await analyzeBrandWebsite(url));
      } catch {
        setAnalysis({ ok: false, error: "Could not reach that site. Check the address and try again." });
      }
    });
  }

  function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const file of Array.from(files)) fd.append("files", file);
    runIntake("upload", () => uploadBrandDocuments(fd));
  }
  const accent = palette[active]?.hex ?? palette[0]?.hex ?? "var(--accent)";
  const tagline = identity.tagline ?? "";
  const headingFont = view.headingFont ?? "Fraunces";
  const bodyFont = view.bodyFont ?? "Geist";

  return (
    <div className="arc-brand" style={{ ["--bactive" as string]: accent }}>
      {/* A failed read renders NEUTRAL_DEFAULTS, which look like a real brand
          kit and are not this tenant's. Say so before anything below is read as
          theirs — and before anyone approves creative drawn from it (BSR-578). */}
      {view.failed && (
        <div
          role="status"
          style={{
            margin: "0 0 14px",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--red-border, rgba(204,102,102,.4))",
            color: "var(--red-text)",
            fontSize: 13,
          }}
        >
          Your brand kit couldn&apos;t be loaded, so what&apos;s shown below are placeholder
          defaults — not your colours, logo or voice. Don&apos;t approve creative from this
          until it reloads.
        </div>
      )}
      {/* HERO */}
      <div className="brandhero">
        <div className="mk2">
          {logoUrl
            ? /* eslint-disable-next-line @next/next/no-img-element -- a tenant-uploaded URL on any host; next/image would need every storage domain allow-listed */
              <img src={logoUrl} alt={`${identity.name} logo`} />
            : <svg viewBox="0 0 24 24"><path d="M5 8l5 4-5 4M11 16h8" /></svg>}
        </div>
        <div className="bid">
          <div className="bname"><span>{identity.name}</span> <span className="bstatus">{identity.published ? "Published" : "Draft"}</span></div>
          {tagline && <div className="btag">{tagline}</div>}
          <div className="bmeta">
            {identity.segments.map((s, i) => (
              <span key={s}>{i > 0 && <span className="dot">·</span>}{s}</span>
            ))}
            {identity.website && (
              <>
                <span className="dot">·</span>
                <a href={identity.website} target="_blank" rel="noreferrer">{identity.website.replace(/^https?:\/\//, "")} ↗</a>
              </>
            )}
            {identity.legalName && <><span className="dot">·</span><span>Legal: {identity.legalName}</span></>}
          </div>
        </div>
        <div className="bacts">
          <input ref={logoInput} type="file" accept={LOGO_ACCEPT} hidden onChange={(e) => onLogoPicked(e.target.files?.[0] ?? null, e, "header")} />
          <button type="button" className="gbtn sm" onClick={() => logoInput.current?.click()} disabled={logoBusy}>
            <svg viewBox="0 0 24 24"><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3M8 9l4-4 4 4M12 5v10" /></svg>
            {logoBusy ? "Uploading…" : logoUrl ? "Replace logo" : "Add logo"}
          </button>
          <span className="blogohint" title="The same logo is editable in Settings → Workspace">Used in the sidebar &amp; on creative</span>
          {logoUrl && !logoBusy && (
            <button type="button" className="gbtn sm" onClick={onLogoRemove}>Remove</button>
          )}
          {logoError && logoErrorAt === "header" && <span className="blogoerr">{logoError}</span>}
          {saved && <span className="bsaved">Saved ✓</span>}
          <button type="button" className="gbtn gold sm" onClick={() => setEditOpen(true)}><svg viewBox="0 0 24 24"><path d="M4 20h4L18 10l-4-4L4 16z" /><path d="M13 5l4 4" /></svg>Edit identity</button>
        </div>
      </div>

      {/* INTAKE */}
      <div className="intake">
        <div className="intakehead">
          <div>
            <div className="ih-title"><span className="sp"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" /></svg></span>Teach Arc your brand</div>
            <div className="ih-sub">Add your website, documents, and logo. Arc reads them and suggests brand details for you to approve — what it learns lands in your <b>Brain</b> and your Brand profile, and <b>nothing is applied until you say so</b>.</div>
          </div>
          <div className="ih-prog">{sources.length} {sources.length === 1 ? "source" : "sources"} connected</div>
        </div>
        <div className="sources">
          <div className="isrc">
            <div className="si"><span className="ic bl"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg></span><div><div className="nm">Website</div><div className="ds">Reads the page — title, description, icon, and copy for Arc</div></div></div>
            <div className="urow">
              <input
                ref={websiteInput}
                defaultValue={identity.website ?? ""}
                placeholder="https://yourbrand.com"
                spellCheck={false}
                onKeyDown={(e) => { if (e.key === "Enter") onAnalyze(); }}
              />
              <button type="button" className="ibtn" onClick={onAnalyze} disabled={analyzing}>
                {analyzing ? "Reading…" : "Analyze"}
              </button>
            </div>
            {analysis && (
              analysis.ok ? (
                <div className="wsresult">
                  <div className="wsrow"><span className="wsl">Title</span><span className="wsv">{analysis.title ?? "—"}</span></div>
                  <div className="wsrow"><span className="wsl">Description</span><span className="wsv">{analysis.description ?? "—"}</span></div>
                  <div className="wsrow"><span className="wsl">Copy read</span><span className="wsv">{analysis.excerpt.length.toLocaleString()} characters</span></div>
                  {analysis.excerpt && <div className="wsexcerpt">{analysis.excerpt}</div>}
                  <div className="wsnote">Nothing saved yet — add what you want Arc to keep as a brand document or in your profile.</div>
                </div>
              ) : (
                <div className="wserror">{analysis.error}</div>
              )
            )}
          </div>
          <div className="isrc">
            <div className="si"><span className="ic gd">{DOC}</span><div><div className="nm">Documents</div><div className="ds">.docx · .pdf · .md · .csv · txt — up to 50&nbsp;MB</div></div></div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={DOC_ACCEPT}
              hidden
              onChange={(e) => { onFilesPicked(e.target.files); e.target.value = ""; }}
            />
            <button
              type="button"
              className={`ucta drop${busy === "upload" ? " is-busy" : ""}`}
              disabled={intake}
              onClick={() => fileInput.current?.click()}
            >
              <svg className="upi" viewBox="0 0 24 24"><path d="M12 16V6M8 10l4-4 4 4" /><path d="M5 16v3a1 1 0 001 1h12a1 1 0 001-1v-3" /></svg>
              <span>{busy === "upload" ? <b>Reading your files…</b> : <><b>Browse files</b> to upload</>}</span>
            </button>
          </div>
          <div className="isrc">
            <div className="si"><span className="ic vi"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="11" r="2" /><path d="M3 17l5-4 4 3 3-2 6 4" /></svg></span><div><div className="nm">Logo</div><div className="ds">Drawn in the sidebar and stamped on creative Arc makes</div></div></div>
            {/* Same action as the "Add logo" button in the header — one logo, one
                write path. This card advertised the capability as "Coming soon"
                while `saveBrandLogo` was wired and working 400px above it, so an
                operator reading this card concluded Arc could not use their logo. */}
            <input ref={cardLogoInput} type="file" accept={LOGO_ACCEPT} hidden onChange={(e) => onLogoPicked(e.target.files?.[0] ?? null, e, "card")} />
            <button
              type="button"
              className={`ucta drop${logoBusy ? " is-busy" : ""}${dragOverLogo ? " is-over" : ""}`}
              disabled={logoBusy}
              onClick={() => cardLogoInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOverLogo(true); }}
              onDragLeave={() => setDragOverLogo(false)}
              onDrop={onLogoDropped}
            >
              <svg className="upi" viewBox="0 0 24 24"><path d="M12 16V6M8 10l4-4 4 4" /><path d="M5 16v3a1 1 0 001 1h12a1 1 0 001-1v-3" /></svg>
              <span>{logoBusy ? <b>Uploading…</b> : logoUrl ? <><b>Replace logo</b> — drop or browse</> : <><b>Drop a logo</b> or browse</>}</span>
            </button>
            {logoError && logoErrorAt === "card" && <span className="blogoerr">{logoError}</span>}
          </div>
          <div className="isrc">
            <div className="si"><span className="ic mu"><svg viewBox="0 0 24 24"><path d="M4 20h4L18 10l-4-4L4 16z" /><path d="M13 5l4 4" /></svg></span><div><div className="nm">Write it yourself</div><div className="ds">Set your name, tagline, website and how Arc should sound</div></div></div>
            {/* Was "Add a brand note", badged "Coming soon". There is no brand-note
                store — but the rest of what this card offered ("edit any field
                below") is exactly `updateBrandIdentity`, which the header's Edit
                identity button already calls. Point at the thing that exists
                rather than promising a note feature that does not. */}
            <button type="button" className="ucta" onClick={() => setEditOpen(true)}>Edit brand details</button>
          </div>
        </div>
      </div>

      <div className="bbody">
        {/* LEFT */}
        <div className="bcol">
          {/* PALETTE */}
          <div className="bsec">
            <div className="bsh"><h3>Brand palette</h3><div className="sx"><span className="editlink" data-soon="Editing the palette is coming soon"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Add color</span></div></div>
            <div className="bsb">
              {palette.length === 0 ? (
                <div className="bsnote" style={{ margin: 0 }}>No palette yet — add colors, or let Arc extract them from your website and logo.</div>
              ) : (
                <div className="swrow">
                  {palette.map((p, i) => {
                    const light = isLight(p.hex);
                    return (
                      <div key={p.role} className={`sw${i === active ? " on" : ""}`} onClick={() => setActive(i)}>
                        <div className="chip" style={{ background: p.hex, ...(light ? {} : { borderBottom: "1px solid var(--line-2)" }) }}>
                          <span className="role" style={light ? { color: "#3a3f4a", textShadow: "none" } : undefined}>{p.role}</span>
                        </div>
                        <div className="meta"><div className="nm">{p.name}</div><div className="hx">{p.hex}</div></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {palette.length > 0 && (
              <div className="bsnote">Click a color to preview it on the ad above. Arc uses these colors on every ad, landing page, and email it makes.</div>
            )}
          </div>

          {/* TYPOGRAPHY */}
          <div className="bsec">
            <div className="bsh"><h3>Typography</h3><div className="sx"><span className="editlink" data-soon="Editing typography is coming soon"><svg viewBox="0 0 24 24"><path d="M4 20h4L18 10l-4-4L4 16z" /></svg>Change</span></div></div>
            <div className="bsb"><div className="typ">
              <div className="tspec serif"><div className="glyph">Aa</div><div className="ti"><div className="role">Display</div><div className="fam">{headingFont}</div><div className="sample">{tagline || "Your headline, set in the display face."}</div></div></div>
              <div className="tspec"><div className="glyph">Aa</div><div className="ti"><div className="role">UI / Body</div><div className="fam">{bodyFont}</div><div className="sample">{proofPoints.slice(0, 2).join(". ") || "Body copy for everyday UI and paragraphs."}</div></div></div>
              <div className="tspec mono"><div className="glyph">Aa</div><div className="ti"><div className="role">Mono / Code</div><div className="fam">{bodyFont} Mono</div><div className="sample">{services[0] ?? "Structured data & labels"}</div></div></div>
            </div></div>
          </div>

          {/* VOICE */}
          {(tone.length > 0 || voiceGuidance || preferredPhrases.length > 0 || bannedPhrases.length > 0) && (
            <div className="bsec">
              {/* Voice guidance is one of the four fields updateBrandIdentity
                  writes, so this was never "coming soon" either — the header's
                  Edit identity button has always saved it. Tone chips and the
                  phrase lists are NOT editable here yet; those come from the
                  profile and Arc's reading of your documents. */}
              <div className="bsh"><h3>Voice &amp; tone</h3><div className="sx"><button type="button" className="editlink" onClick={() => setEditOpen(true)}><svg viewBox="0 0 24 24"><path d="M4 20h4L18 10l-4-4L4 16z" /></svg>Edit</button></div></div>
              <div className="bsb">
                {tone.length > 0 && <div className="tone">{tone.map((t) => <span className="tchip" key={t}>{t}</span>)}</div>}
                {voiceGuidance && <p className="guide">{voiceGuidance}</p>}
                {(preferredPhrases.length > 0 || bannedPhrases.length > 0) && (
                  <div className="phr">
                    <div><div className="pl">{CHECK}Preferred</div><div className="words">{preferredPhrases.map((w) => <span className="word" key={w}>{w}</span>)}</div></div>
                    <div><div className="pl ban">{BAN}Banned</div><div className="words">{bannedPhrases.map((w) => <span className="word ban" key={w}>{w}</span>)}</div></div>
                  </div>
                )}
                {/* The "How Arc will write" card was removed: it printed a fixed
                    roofing email captioned "in your voice" — another company's copy,
                    shown to every workspace directly under their real tone chips — and a
                    literal "0 banned phrases" that stayed 0 no matter how many were set.
                    Nothing generated it. Restore this only behind a real generation call. */}
              </div>
              {bannedPhrases.length > 0 && (
                <div className="bsnote">Arc enforces banned phrases as a <b>guardrail</b> — drafts using them are flagged before they reach approval.</div>
              )}
            </div>
          )}

          {/* PROOF / GUARDRAILS / SERVICES */}
          <div className="bsec">
            <div className="bsh"><h3>Proof, guardrails &amp; offering</h3></div>
            <div className="bsb">
              <div className="twocol">
                <div>
                  <div className="pl" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 6px" }}>Proof points</div>
                  <div className="flist">{proofPoints.map((t, i) => <div key={i} className="fitem"><span className="fi ok">{CHECK}</span><span>{t}</span></div>)}</div>
                  <div className="pl" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--muted)", margin: "16px 0 6px" }}>Offering</div>
                  <div className="flist">{services.map((t, i) => <div key={i} className="fitem"><span className="fi sv"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /></svg></span><span>{t}</span></div>)}</div>
                </div>
                <div>
                  <div className="pl" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--red-text)", margin: "0 0 6px" }}>Guardrails — Arc will not</div>
                  <div className="flist">{guardrails.map((t, i) => <div key={i} className="fitem"><span className="fi gd">{BAN}</span><span>{t}</span></div>)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div className="brail">
          {/* The "Live brand preview" card was removed. Its caption claimed "This
              composite is generated from your palette, fonts & an approved Library
              photo", but the image was a single hardcoded CloudFront URL — one fixed
              photo of a house, identical for every workspace — under a hardcoded
              "Book a free inspection →" CTA. Only the name/tagline/proof overlay was
              real. There is no brand-composite generator, so there was nothing
              truthful to render; the aspect-ratio buttons only re-cropped the same
              stock photo. Rebuild this against a real composite call, not a fixture. */}
          <div className="bsec">
            <div className="bsh"><h3>Creative preview</h3></div>
            <div className="bsb">
              <p style={{ margin: 0, fontSize: "12.5px", lineHeight: 1.65, color: "var(--muted)" }}>
                Brand-composite previews aren&rsquo;t generated yet. Build a creative on your own approved
                media in <a href={STUDIO} style={{ color: "var(--accent)" }}>Studio</a> — it uses this brand
                kit for colors, type and copy.
              </p>
            </div>
          </div>

          {/* BRAND SOURCES */}
          <div className="bsec">
            <div className="bsh"><h3>Brand sources</h3><div className="sx">
              <button type="button" className="resyncall" disabled={intake || sources.length === 0} onClick={() => runIntake("resync", () => resyncBrandSources())}>{RESYNC}{busy === "resync" ? "Re-syncing…" : "Re-sync all"}</button>
              <button type="button" className="gbtn gold sm" disabled={intake} onClick={() => fileInput.current?.click()}><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>Upload</button>
            </div></div>
            {(syncSummary || intakeError) && (
              <div className={`bsync${intakeError ? " err" : syncSummary?.ok ? " ok" : " warn"}`} role="status" aria-live="polite">
                <b>{intakeError ?? syncSummary?.message}</b>
                {!intakeError && syncSummary?.items.length ? (
                  <ul>{syncSummary.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
                ) : null}
                {!intakeError && (syncSummary?.items.length ?? 0) > 0 ? <a className="bsync-go" href={BRAIN}>Review in Brain →</a> : null}
              </div>
            )}
            <div className="bsb" style={{ paddingTop: 6 }}>
              {sources.length === 0 ? (
                <div className="bsnote" style={{ margin: 0 }}>No brand sources yet — upload a deck, brief, or guidelines and Arc will read them into your Brain.</div>
              ) : (
                sources.map((s) => (
                  <a key={s.id ?? s.name} className="src" href={BRAIN}>
                    <span className="di">{DOC}<span className="ext" style={s.extColor ? { background: s.extColor } : undefined}>{s.ext}</span></span>
                    <div className="si"><div className="sn">{s.name}</div><div className="sm"><b>{s.facts}</b>{s.when && ` · ${s.when}`}{s.stale && <span className="stale">stale</span>}</div></div>
                    {s.id ? (
                      <button
                        type="button"
                        className={`resync${busy === s.id ? " is-busy" : ""}`}
                        title="Re-sync this source"
                        disabled={intake}
                        onClick={(e) => { e.preventDefault(); runIntake(s.id!, () => resyncBrandSources(s.id)); }}
                      >{RESYNC}</button>
                    ) : null}
                    <span className="sgo">→</span>
                  </a>
                ))
              )}
            </div>
            <div className="bsnote">Upload a deck, brief, or guidelines (Word, PDF, Markdown or CSV). Arc reads it and adds what it learns to the <b>Brain</b> as facts waiting on your approval. <b>Re-sync</b> re-reads a source when your documents change. Click a source to see what it learned.</div>
          </div>

          {/* ARC USES THIS */}
          <div className="arcnote">
            <span className="am">A</span>
            <div className="an"><b>How Arc uses your brand.</b> Every draft — ad, email, SMS, landing page — pulls these colors, fonts, voice and proof points, and is checked against your guardrails before it ever reaches the approval queue.</div>
          </div>
        </div>
      </div>

      <EditIdentityModal
        key={editOpen ? "open" : "closed"}
        open={editOpen}
        initial={{
          displayName: identity.name,
          tagline: identity.tagline ?? "",
          websiteUrl: identity.website ?? "",
          voiceGuidance: voiceGuidance ?? "",
        }}
        onClose={() => setEditOpen(false)}
        onSubmit={async (value) => {
          const res = await updateBrandIdentity(value);
          if (res.ok) {
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
          }
          return res;
        }}
      />
    </div>
  );
}
