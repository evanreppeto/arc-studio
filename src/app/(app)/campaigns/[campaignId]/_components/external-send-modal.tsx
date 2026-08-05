"use client";

import { useEffect, useState } from "react";

import { Modal } from "../../../_components/modal";
import {
  exportCampaignAssetForExternalSend,
  markCampaignAssetSentExternally,
  type ExternalSendPackageActionResult,
} from "../actions";

/**
 * BYO send channel: hand the approved deliverable to the workspace's own email
 * tool. Everything here is already attribution-stamped server-side (utm +
 * bsg_at on every first-party link), so clicks and resulting leads still
 * attribute to this campaign — and "Mark as sent" records the outbound touches
 * so journeys and the learning loop see a send the app didn't perform.
 */
export function ExternalSendModal({
  campaignId,
  assetId,
  assetTitle,
  open,
  onClose,
}: {
  campaignId: string;
  assetId: string;
  assetTitle: string;
  open: boolean;
  onClose: () => void;
}) {
  const [result, setResult] = useState<ExternalSendPackageActionResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tool, setTool] = useState("");
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState<string | null>(null);

  // The parent mounts a fresh modal per deliverable, so initial state covers
  // the reset; this effect only fetches (async setState — no cascading render).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    exportCampaignAssetForExternalSend(campaignId, assetId).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [open, campaignId, assetId]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1800);
    } catch {
      setCopied(null);
    }
  }

  async function markSent() {
    setMarking(true);
    setMarked(null);
    const res = await markCampaignAssetSentExternally(campaignId, assetId, tool.trim() || undefined);
    setMarking(false);
    setMarked(res.ok ? `Recorded — ${res.recipients} outbound touch(es) now feed journeys and learning.` : res.error);
  }

  const pkg = result?.ok ? result.pkg : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title="Send it yourself"
      description={`Use your own email tool for “${assetTitle}”. Links are already tagged, so clicks and leads still attribute to this campaign.`}
    >
      <div className="extsend">
        {!result ? (
          <p className="exhint">Preparing the export…</p>
        ) : !result.ok ? (
          <p className="exerr">{result.error}</p>
        ) : pkg ? (
          <>
            <div className="exsec">
              <div className="exlabel">
                <span>Subject</span>
                <button type="button" className="cbtn ghost" onClick={() => copy("subject", pkg.subject)}>
                  {copied === "subject" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="exvalue">{pkg.subject}</div>
            </div>

            <div className="exsec">
              <div className="exlabel">
                <span>Email body (HTML)</span>
                <button type="button" className="cbtn ghost" onClick={() => copy("html", pkg.html)}>
                  {copied === "html" ? "Copied" : "Copy HTML"}
                </button>
              </div>
              <textarea className="exbody" readOnly value={pkg.html} rows={5} />
              <div className="exlabel" style={{ marginTop: 8 }}>
                <span>Plain text</span>
                <button type="button" className="cbtn ghost" onClick={() => copy("text", pkg.text)}>
                  {copied === "text" ? "Copied" : "Copy text"}
                </button>
              </div>
              <textarea className="exbody" readOnly value={pkg.text} rows={4} />
            </div>

            <div className="exsec">
              <p className="exhint">
                The body carries your postal address and an unsubscribe link, as the law requires.
                Map <code>{pkg.unsubscribeMergeToken}</code> to the CSV&apos;s <code>unsubscribe_url</code>{" "}
                column in your tool so each recipient gets their own working link.
              </p>
            </div>

            <div className="exsec">
              <div className="exlabel">
                <span>
                  Audience — {pkg.recipients.length} recipient(s)
                  {pkg.suppressedCount > 0
                    ? ` · ${pkg.suppressedCount} left out${
                        pkg.unsubscribedCount > 0 ? `, ${pkg.unsubscribedCount} of them unsubscribed or bounced` : ""
                      }`
                    : ""}
                </span>
                <span className="exactions">
                  <button type="button" className="cbtn ghost" onClick={() => copy("csv", pkg.audienceCsv)}>
                    {copied === "csv" ? "Copied" : "Copy CSV"}
                  </button>
                  <a
                    className="cbtn ghost"
                    href={`data:text/csv;charset=utf-8,${encodeURIComponent(pkg.audienceCsv)}`}
                    download={`${pkg.title.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase() || "audience"}.csv`}
                  >
                    Download CSV
                  </a>
                </span>
              </div>
            </div>

            <div className="exsec exmark">
              <div className="exlabel"><span>After it goes out</span></div>
              <p className="exhint">
                Tell the workspace it was sent so journeys, performance, and Arc&apos;s learning see the touch.
                Recording is idempotent — marking twice can&apos;t double-count.
              </p>
              <div className="exmarkrow">
                <input
                  className="exinput"
                  placeholder="Which tool? (Mailchimp, Klaviyo, …) — optional"
                  value={tool}
                  onChange={(event) => setTool(event.target.value)}
                />
                <button type="button" className="cbtn gold" disabled={marking} onClick={markSent}>
                  {marking ? "Recording…" : "Mark as sent"}
                </button>
              </div>
              {marked ? <p className="exhint exdone">{marked}</p> : null}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
