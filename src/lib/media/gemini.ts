import { GenerateVideosOperation, GoogleGenAI, PersonGeneration } from "@google/genai";
import { randomUUID } from "node:crypto";

import type { GeneratedMedia, ImageGenInput, MediaProvider, VideoGenInput, VideoStart, VideoPoll } from "./types";

// Default to gemini-2.5-flash-image (Nano Banana) for conversational editing
// and reference-image augmentation. Override with GEMINI_IMAGE_MODEL — e.g.
// "gemini-3-pro-image" (max quality) or an explicit Imagen id if you have
// access and need the Imagen path.
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

// Aspect ratios accepted by both Imagen 4 and Gemini flash-image; anything else
// falls back to the model default.
const SUPPORTED_ASPECT_RATIOS = new Set(["1:1", "3:4", "4:3", "9:16", "16:9"]);

const DEFAULT_VIDEO_MODEL = "veo-3.1-fast-generate-preview";
const SUPPORTED_VIDEO_ASPECT = new Set(["16:9", "9:16"]);

/**
 * Person generation policy for Veo.
 *
 * This was hardcoded to ALLOW_ADULT, which made EVERY video call fail with a
 * 400: "allow_adult for personGeneration is currently not supported."
 *
 * Probed against live veo-3.1-fast on 2026-08-03, ALL THREE values were tried
 * and only one is accepted:
 *
 *   ALLOW_ADULT -> 400 rejected
 *   DONT_ALLOW  -> 400 rejected ("dont_allow ... is currently not supported")
 *   ALLOW_ALL   -> accepted, operation starts
 *
 * So this is not the documented allowlist story (which says allow_adult is the
 * default and the restricted one) — on this model the enum is effectively
 * single-valued. Hence ALLOW_ALL as the default: it is the only value that
 * renders at all. NOTE the consequence — we cannot currently restrict person
 * generation at the API level, so the human approval gate is the only control
 * over who appears in a generated video.
 *
 * Override with GEMINI_VIDEO_PERSON_GENERATION if a future model revision
 * accepts the stricter values, with no code change.
 */
const DEFAULT_PERSON_GENERATION = "ALLOW_ALL";
const PERSON_GENERATION_VALUES = new Set(Object.values(PersonGeneration) as string[]);

/** Normalize a person-generation policy to a value the SDK enum accepts. */
export function resolvePersonGeneration(stored: string | undefined, env: string | undefined): PersonGeneration {
  const candidate = (stored?.trim() || env?.trim() || DEFAULT_PERSON_GENERATION).toUpperCase();
  const value = PERSON_GENERATION_VALUES.has(candidate) ? candidate : DEFAULT_PERSON_GENERATION;
  return value as PersonGeneration;
}

/** Pick a model: stored pref (if non-empty) -> env -> built-in default. Pure + testable. */
export function resolveModel(stored: string | undefined, env: string | undefined, fallback: string): string {
  return (stored && stored.trim()) || (env && env.trim()) || fallback;
}

/** Google Gemini provider — Imagen 4 (generateImages) or Gemini flash-image
 *  ("Nano Banana", generateContent), selected by model id. */
export function createGeminiMediaProvider(
  apiKey: string,
  opts?: { imageModel?: string; videoModel?: string },
): MediaProvider {
  const ai = new GoogleGenAI({ apiKey });
  const imageModel = resolveModel(opts?.imageModel, process.env.GEMINI_IMAGE_MODEL, DEFAULT_IMAGE_MODEL);
  const videoModel = resolveModel(opts?.videoModel, process.env.GEMINI_VIDEO_MODEL, DEFAULT_VIDEO_MODEL);
  return {
    async generateImage(input: ImageGenInput): Promise<GeneratedMedia> {
      const model = imageModel;
      const aspectRatio =
        input.aspectRatio && SUPPORTED_ASPECT_RATIOS.has(input.aspectRatio) ? input.aspectRatio : undefined;

      // Imagen models use the dedicated generateImages endpoint.
      if (model.startsWith("imagen")) {
        const response = await ai.models.generateImages({
          model,
          prompt: input.prompt,
          config: {
            numberOfImages: 1,
            personGeneration: PersonGeneration.ALLOW_ADULT, // marketing scenes routinely include people
            ...(aspectRatio ? { aspectRatio } : {}),
          },
        });
        const image = response.generatedImages?.[0]?.image;
        if (image?.imageBytes) {
          return {
            bytes: Buffer.from(image.imageBytes, "base64"),
            contentType: image.mimeType ?? "image/png",
            model,
            jobId: randomUUID(),
          };
        }
        throw new Error("Imagen returned no image data (it may have been safety-filtered)");
      }

      // Gemini *-image models ("Nano Banana") use conversational generateContent.
      const response = await ai.models.generateContent({
        model,
        contents: input.prompt,
        ...(aspectRatio ? { config: { imageConfig: { aspectRatio } } } : {}),
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const inline = part.inlineData;
        if (inline?.data) {
          return {
            bytes: Buffer.from(inline.data, "base64"),
            contentType: inline.mimeType ?? "image/png",
            model,
            jobId: randomUUID(),
          };
        }
      }
      throw new Error("Gemini returned no image data");
    },
    async startVideo(input: VideoGenInput): Promise<VideoStart> {
      const model = videoModel;
      const aspectRatio =
        input.aspectRatio && SUPPORTED_VIDEO_ASPECT.has(input.aspectRatio) ? input.aspectRatio : undefined;
      const operation = await ai.models.generateVideos({
        model,
        prompt: input.prompt,
        config: {
          numberOfVideos: 1,
          personGeneration: resolvePersonGeneration(
            input.personGeneration,
            process.env.GEMINI_VIDEO_PERSON_GENERATION,
          ),
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(input.durationSeconds ? { durationSeconds: input.durationSeconds } : {}),
        },
      });
      const operationName = operation.name;
      if (!operationName) throw new Error("Veo did not return an operation name");
      return { operationName, model, jobId: randomUUID() };
    },
    async pollVideo(operationName: string): Promise<VideoPoll> {
      // The SDK calls `operation._fromAPIResponse(...)` on whatever it is handed,
      // so it needs a REAL GenerateVideosOperation, not an object literal wearing
      // its type. The old `as` cast satisfied the compiler and then threw
      // "t._fromAPIResponse is not a function" on every single poll — start and
      // poll are separate stateless HTTP requests here, so we cannot keep the
      // instance the way the SDK's own example does; we rebuild it by name.
      const handle = new GenerateVideosOperation();
      handle.name = operationName;
      const operation = await ai.operations.getVideosOperation({ operation: handle });
      if (!operation.done) return { status: "running" };
      const video = operation.response?.generatedVideos?.[0]?.video;
      if (!video) throw new Error("Veo finished but returned no video (it may have been safety-filtered)");
      const contentType = video.mimeType ?? "video/mp4";
      if (video.videoBytes) {
        return { status: "done", bytes: Buffer.from(video.videoBytes, "base64"), contentType };
      }
      if (video.uri) {
        const res = await fetch(video.uri, { headers: { "x-goog-api-key": apiKey } });
        if (!res.ok) throw new Error(`Veo video download failed: ${res.status}`);
        return { status: "done", bytes: Buffer.from(await res.arrayBuffer()), contentType };
      }
      throw new Error("Veo result had neither videoBytes nor uri");
    },
  };
}
