"use client";

import { useRef, useState, useTransition } from "react";

import {
  BRANDING_IMAGE_ACCEPT,
  BRANDING_IMAGE_MAX_BYTES,
  BRANDING_IMAGE_MAX_LABEL,
} from "@/domain/branding-image";

import type { BrandingResult } from "../branding-actions";
import { AppImage } from "../../_components/app-image";

type Props = {
  /** Current image URL, or null to show the initials fallback. */
  currentUrl: string | null;
  /** Initials shown when there's no image. */
  fallback: string;
  /** "square" for a logo, "circle" for an avatar. */
  shape?: "square" | "circle";
  uploadAction: (formData: FormData) => Promise<BrandingResult>;
  removeAction: () => Promise<BrandingResult>;
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Compact image-upload control for a settings Row: a preview thumbnail plus
 * Upload/Replace + Remove. Submits the chosen file to a server action as
 * FormData and reflects the returned URL. Errors surface inline without losing
 * the previously-shown image.
 */
export function ImageUploadField({ currentUrl, fallback, shape = "square", uploadAction, removeAction }: Props) {
  const [url, setUrl] = useState<string | null>(currentUrl);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<"upload" | "remove" | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const subject = shape === "circle" ? "profile photo" : "workspace logo";

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = ""; // let the same file be re-picked after a remove
    if (!chosen) return;
    if (chosen.size > BRANDING_IMAGE_MAX_BYTES) {
      setError(`Image is too large — keep it under ${BRANDING_IMAGE_MAX_LABEL}.`);
      return;
    }
    setError(null);
    setOperation("upload");
    const formData = new FormData();
    formData.append("file", chosen);
    start(async () => {
      try {
        const result = await uploadAction(formData);
        if (result.ok) setUrl(result.url);
        else setError(result.error);
      } catch (caught) {
        setError(message(caught, "Could not upload that image. Try again."));
      } finally {
        setOperation(null);
      }
    });
  }

  function onRemove() {
    setError(null);
    setOperation("remove");
    start(async () => {
      try {
        const result = await removeAction();
        if (result.ok) setUrl(null);
        else setError(result.error);
      } catch (caught) {
        setError(message(caught, "Could not remove that image. Try again."));
      } finally {
        setOperation(null);
      }
    });
  }

  return (
    <div className="imgup">
      <div className="imgup-row">
        <span className={`imgup-pv${shape === "circle" ? " circle" : ""}${url ? " has-image" : ""}`}>
          {url ? (
            <AppImage src={url} alt={`Current ${subject}`} />
          ) : (
            <span className="imgup-fb">{fallback}</span>
          )}
        </span>
        <button
          type="button"
          className="btn sm"
          disabled={pending}
          aria-label={url ? `Replace ${subject}` : `Upload ${subject}`}
          onClick={() => inputRef.current?.click()}
        >
          {pending && operation === "upload" ? "Uploading…" : url ? "Replace" : "Upload"}
        </button>
        {url && (
          <button type="button" className="btn sm" disabled={pending} aria-label={`Remove ${subject}`} onClick={onRemove}>
            {pending && operation === "remove" ? "Removing…" : "Remove"}
          </button>
        )}
      </div>
      {error && <div className="imgup-err" role="alert">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={BRANDING_IMAGE_ACCEPT}
        aria-label={`Choose ${subject}`}
        hidden
        onChange={onPick}
      />
    </div>
  );
}
