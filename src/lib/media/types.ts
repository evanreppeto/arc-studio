/** Provider-agnostic media generation. Swap Gemini → Higgsfield/Vertex behind this. */
export type ImageGenInput = { prompt: string; aspectRatio?: string };

/**
 * Edit an image that already exists, rather than making a new one from words.
 *
 * The distinction matters for creative: "put our logo on the van door" and
 * "warm the morning light" are edits to a picture the operator already approved
 * of, and regenerating from a prompt throws that picture away and rolls the dice
 * again. Studio had no way to express them at all — the provider could only
 * generate — which is why the app told operators their logo "couldn't" go on the
 * truck. It was never a rule; there was simply no edit path.
 */
export type ImageEditInput = {
  /** The image being edited. */
  bytes: Buffer;
  contentType: string;
  /** What to change about it, in the operator's words. */
  instruction: string;
};

/** Thrown when the configured model cannot edit — Imagen generates only. Its own
 *  type so a caller can tell "your model can't do this" from "the call failed". */
export class ImageEditUnsupportedError extends Error {
  constructor(model: string) {
    super(`${model} can only generate images, not edit them. Choose a Gemini image model in Settings to edit.`);
    this.name = "ImageEditUnsupportedError";
  }
}

export type GeneratedMedia = {
  bytes: Buffer;
  contentType: string;
  model: string;
  jobId: string;
};

export type VideoGenInput = {
  prompt: string;
  /**
   * A still to animate, rather than a scene invented from the prompt alone.
   *
   * Studio has always offered "Animate" — "add gentle motion to this image" —
   * and had no way to send the image, so it produced an unrelated clip from the
   * words and discarded the picture the operator was pointing at. Same shape as
   * the missing image edit: they point at something they have, and the system
   * regenerates from scratch.
   *
   * Veo takes either a prompt or a starting image (or both); it will not take an
   * image and a source video together.
   */
  image?: { bytes: Buffer; contentType: string };
  aspectRatio?: string;
  durationSeconds?: number;
  /** DONT_ALLOW | ALLOW_ADULT | ALLOW_ALL. Omit for the deployment default. */
  personGeneration?: string;
};
export type VideoStart = { operationName: string; model: string; jobId: string };
export type VideoPoll =
  | { status: "running" }
  | { status: "done"; bytes: Buffer; contentType: string };

/**
 * A started image job. Present only on engines where an image is a job rather
 * than an inline response — see `MediaProvider.startImage`.
 */
export type ImageStart = { operationName: string; model: string; jobId: string };
export type ImagePoll =
  | { status: "running" }
  | { status: "done"; bytes: Buffer; contentType: string; model: string; jobId: string };

export interface MediaProvider {
  generateImage(input: ImageGenInput): Promise<GeneratedMedia>;
  /**
   * Start an image job, for engines where images are asynchronous.
   *
   * OPTIONAL because the two engines genuinely differ, and pretending otherwise
   * is what broke: Gemini returns bytes inline in a second or two, while a real
   * Higgsfield image measured ~75s — longer than a serverless request may live.
   * A caller that finds these present should submit and poll (as the video flow
   * already does); one that doesn't can call generateImage and block.
   */
  startImage?(input: ImageGenInput): Promise<ImageStart>;
  pollImage?(operationName: string): Promise<ImagePoll>;
  /** Edit an existing image. Throws ImageEditUnsupportedError on generate-only
   *  models, so the caller can say which model and why rather than "failed". */
  editImage(input: ImageEditInput): Promise<GeneratedMedia>;
  startVideo(input: VideoGenInput): Promise<VideoStart>;
  pollVideo(operationName: string): Promise<VideoPoll>;
}
