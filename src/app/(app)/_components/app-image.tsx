"use client";

import { useCallback, useState, type ImgHTMLAttributes } from "react";

type AppImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
};

/**
 * An `<img>` that shows a skeleton until it has actually decoded, then fades in.
 *
 * Why not `next/image`: every call site that renders one of these is showing a
 * *user media URL* — an uploaded workspace logo, an operator avatar, a generated
 * creative in Supabase storage — so the host is not knowable at build time and
 * `next/image` would need per-host `remotePatterns` for each. That constraint is
 * real and is why the raw tags exist; it is orthogonal to this component, which
 * fixes the part that was never host-dependent.
 *
 * Why no wrapper element: the boxes are already sized by their parents (`.pav` is
 * 56×56, `.dthumb`, `.av`, `.ws-item-mk` …). Introducing a wrapper here would be a
 * layout change on ~10 screens, so the skeleton is painted as the image's *own*
 * background — an `<img>` renders its background behind its image content, so the
 * placeholder occupies exactly the right box and vanishes the moment real pixels
 * land. See `.appimg` in globals.css.
 *
 * The load flag is stored as the src it belongs to rather than a boolean, so a
 * changed src resets to the skeleton without a `setState` in an effect.
 */
export function AppImage({ src, alt, className, ...rest }: AppImageProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  // A cached image can finish decoding before React attaches `onLoad`, which would
  // otherwise strand it on the skeleton forever. The callback ref re-runs whenever
  // `src` changes; the attribute check keeps a still-attached *previous* image from
  // marking the new src as loaded.
  const attach = useCallback(
    (el: HTMLImageElement | null) => {
      if (el && el.getAttribute("src") === src && el.complete && el.naturalWidth > 0) {
        setLoadedSrc(src);
      }
    },
    [src],
  );

  return (
    // eslint-disable-next-line @next/next/no-img-element -- user media URL; next/image would need per-host remotePatterns (see above)
    <img
      loading="lazy"
      decoding="async"
      {...rest}
      ref={attach}
      src={src}
      alt={alt}
      className={className ? `appimg ${className}` : "appimg"}
      data-loaded={loadedSrc === src ? "true" : "false"}
      onLoad={() => setLoadedSrc(src)}
    />
  );
}
