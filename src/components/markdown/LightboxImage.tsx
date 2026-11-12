import { type CSSProperties, type SyntheticEvent, useCallback, useRef, useState } from "react";
import type { LightboxImageItem, NaturalSize } from "@/lib/lightbox";
import { svgSizeFromUrl } from "@/lib/svgSizeFromUrl";

interface LightboxImageProps {
  image: LightboxImageItem;
  scale: number;
  /** Reports the intrinsic size, or null for an image without one, for the fit. */
  onMeasure: (size: NaturalSize | null) => void;
}

// An image or rendered diagram in the lightbox, laid out at `natural × scale`
// so zooming past the viewport pans rather than clips.
export function LightboxImage({ image, scale, onMeasure }: LightboxImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  // Intrinsic pixel size, or null when the image has none (SVGs with only a
  // `viewBox` report naturalWidth/Height === 0). Drives the sizing model below.
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  // Navigation swaps the src on this same element, which drag-pan observes:
  // the next image starts unloaded and unmeasured.
  const [shownSrc, setShownSrc] = useState(image.src);
  if (image.src !== shownSrc) {
    setShownSrc(image.src);
    setLoaded(false);
    setNatural(null);
  }

  const applySize = useCallback(
    (size: NaturalSize | null) => {
      setNatural(size);
      onMeasure(size);
    },
    [onMeasure],
  );

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      setLoaded(true);
      // SVGs with only a viewBox report no intrinsic pixel size; recover one from
      // the markup (decoded from a data URL, or fetched for asset/remote SVGs) so
      // the image still lays out at natural × scale and pans when zoomed. Only a
      // size-less unparseable source keeps the contained layout below.
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        applySize({ w: img.naturalWidth, h: img.naturalHeight });
        return;
      }
      applySize(null);
      const src = img.src;
      svgSizeFromUrl(src).then((size) => {
        // Drop the result if the user has navigated to another image meanwhile.
        if (size && imgRef.current?.src === src) applySize(size);
      });
    },
    [applySize],
  );

  // With an intrinsic size we lay the image out at `natural × scale` so zooming
  // past the viewport pans. Without one (an SVG with only a viewBox) there are
  // no pixels to multiply, so fill the stage with object-fit contain and zoom
  // via transform: max-width alone caps the size but can't enlarge it.
  const imageStyle: CSSProperties = natural
    ? // `natural` is only set together with `loaded` in handleLoad, so it's
      // always loaded by the time this branch renders.
      { width: natural.w * scale, opacity: 1 }
    : {
        width: "100%",
        height: "100%",
        objectFit: "contain",
        transform: `scale(${scale})`,
        opacity: loaded ? 1 : 0,
        // The stretched element owns the letterbox around the visible image;
        // letting clicks through keeps the backdrop's click-to-close working.
        pointerEvents: "none",
      };

  return (
    <img
      ref={imgRef}
      src={image.src}
      alt={image.alt}
      className="lightbox-image"
      style={imageStyle}
      onLoad={handleLoad}
      draggable={false}
    />
  );
}
