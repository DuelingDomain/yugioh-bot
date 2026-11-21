"use client";

import * as React from "react";
import { cardImageUrl } from "@/lib/card-image-url";

const RETRIES = 3;

/**
 * A tile-size card picture (WebP, about 7 KB). The first rows load at once, the rest when scrolled near.
 * Until the picture is ready the tile shows a card-back shimmer instead of a dark box, and a failed load
 * (a busy server answers 429 or 503) is tried again a few times, because a browser never retries an image itself.
 */
export function CubeThumb({ id, eager = false }: { id: number; eager?: boolean }) {
  const [attempt, setAttempt] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const retry = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(retry.current), []);
  // A picture from the browser cache can finish before React attaches onLoad.
  React.useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  const src = cardImageUrl(id, "thumb") + (attempt ? `&r=${attempt}` : "");
  return (
    <>
      {loaded || failed ? null : <span className="ct-wait" aria-hidden="true" />}
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={src}
          alt=""
          width={200}
          height={292}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={eager ? "high" : "auto"}
          data-loaded={loaded ? "" : undefined}
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (attempt >= RETRIES) { setFailed(true); return; }
            retry.current = setTimeout(() => setAttempt((n) => n + 1), 1200 * (attempt + 1));
          }}
        />
      )}
    </>
  );
}
