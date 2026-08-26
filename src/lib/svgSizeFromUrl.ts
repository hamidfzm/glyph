import { decodeSvgDataUrl } from "@/lib/svgDataUrl";
import { svgIntrinsicSize } from "@/lib/svgIntrinsicSize";

// Height the hidden probe renders at; the synthesized size is this tall.
const PROBE_HEIGHT = 1000;

// Measure an image's intrinsic aspect ratio by laying out a hidden copy at a
// fixed height: a viewBox-only SVG has an intrinsic ratio but no size, so the
// browser resolves the auto width from the ratio. Works for any loadable URL
// (asset protocol, remote) without re-reading the bytes, which the asset
// server refuses to serve to script fetches.
function probeAspectSize(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const probe = document.createElement("img");
    const done = (size: { w: number; h: number } | null) => {
      probe.remove();
      resolve(size);
    };
    const measure = () => {
      const w = probe.offsetWidth;
      done(w > 0 ? { w, h: PROBE_HEIGHT } : null);
    };
    probe.onload = measure;
    probe.onerror = () => done(null);
    probe.style.cssText = `position:absolute;visibility:hidden;height:${PROBE_HEIGHT}px;width:auto;`;
    probe.src = src;
    document.body.appendChild(probe);
    if (probe.complete) measure();
  });
}

// Layout size for an SVG the webview reported as 0x0 (viewBox-only markup):
// exact viewBox units when the markup is in the URL (diagram data URLs),
// otherwise a ratio-true size measured from a hidden render. Resolves null
// when the source has no usable dimensions at all.
export async function svgSizeFromUrl(src: string): Promise<{ w: number; h: number } | null> {
  const inline = decodeSvgDataUrl(src);
  if (inline) return svgIntrinsicSize(inline);
  if (src.startsWith("data:")) return null;
  return probeAspectSize(src);
}
