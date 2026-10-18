'use client';
import { useState, type ReactNode } from 'react';

/** The photo route needs the session cookie, so the image optimizer cannot fetch it. */
export function PhotoImg({
  src,
  size,
  onError,
}: {
  src: string;
  size: number;
  onError?: () => void;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see above; next/image would only add a wrapper
    <img
      className="ph-img"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={onError}
      // An image that failed before hydration fires no error event, so the ref looks at it once.
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) onError?.();
      }}
    />
  );
}

/** The photo, or the fallback when there is none or it fails to load (404, 429, 500). */
export function PhotoOr({
  src,
  size,
  children,
  onError,
}: {
  src: string | null | undefined;
  size: number;
  children: ReactNode;
  onError?: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <>{children}</>;
  return (
    <PhotoImg
      src={src}
      size={size}
      onError={() => {
        setFailed(src);
        onError?.();
      }}
    />
  );
}
