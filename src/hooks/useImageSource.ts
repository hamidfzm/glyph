import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { toAssetUrl } from "@/components/markdown/resolveImageSrc";
import { isSvgFile } from "@/lib/imageExtensions";
import { svgToDataUrl } from "@/lib/svgDataUrl";
import { svgIntrinsicSize } from "@/lib/svgIntrinsicSize";

/**
 * The `<img>` src for an image file tab, plus any intrinsic size parsed out of
 * an SVG's markup (used when the webview reports naturalWidth/Height as 0).
 *
 * SVGs render from their inlined markup as a `data:` URL rather than the asset
 * protocol: it always loads (no protocol round-trip that can come back empty)
 * and the markup is cheap to read. Raster assets keep the asset protocol. The
 * initial null src means the `<img>` stays empty for one tick until the read
 * resolves.
 */
export function useImageSource(filePath: string) {
  const svgSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [src, setSrc] = useState<string | null>(isSvgFile(filePath) ? null : toAssetUrl(filePath));

  useEffect(() => {
    if (!isSvgFile(filePath)) {
      setSrc(toAssetUrl(filePath));
      return;
    }
    let cancelled = false;
    invoke<string>("read_file", { path: filePath })
      .then((svg) => {
        if (cancelled) return;
        svgSizeRef.current = svgIntrinsicSize(svg);
        setSrc(svgToDataUrl(svg));
      })
      // Fall back to the asset protocol if the read fails for any reason.
      .catch(() => {
        if (!cancelled) setSrc(toAssetUrl(filePath));
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return { src, svgSizeRef };
}
