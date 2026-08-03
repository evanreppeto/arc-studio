/** Provider-agnostic media generation. Swap Gemini → Higgsfield/Vertex behind this. */
export type ImageGenInput = { prompt: string; aspectRatio?: string };

export type GeneratedMedia = {
  bytes: Buffer;
  contentType: string;
  model: string;
  jobId: string;
};

export type VideoGenInput = {
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  /** DONT_ALLOW | ALLOW_ADULT | ALLOW_ALL. Omit for the deployment default. */
  personGeneration?: string;
};
export type VideoStart = { operationName: string; model: string; jobId: string };
export type VideoPoll =
  | { status: "running" }
  | { status: "done"; bytes: Buffer; contentType: string };

export interface MediaProvider {
  generateImage(input: ImageGenInput): Promise<GeneratedMedia>;
  startVideo(input: VideoGenInput): Promise<VideoStart>;
  pollVideo(operationName: string): Promise<VideoPoll>;
}
