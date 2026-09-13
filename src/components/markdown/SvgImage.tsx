import type { SVGProps } from "react";
import { useAssetRef } from "@/hooks/useAssetRef";

interface SvgImageProps extends SVGProps<SVGImageElement> {
  filePath: string | undefined;
  node?: unknown;
}

// An inline-SVG <image> with its href resolved like a markdown image, so
// workspace-relative icon paths load through the asset protocol.
export function SvgImage({ filePath, href, xlinkHref, node: _node, ...rest }: SvgImageProps) {
  // || not ??: some SVG tooling writes href="" beside a valid xlink:href.
  const candidate = href || xlinkHref;
  // The sanitizer's shared href protocol list admits anchor schemes (mailto:,
  // irc:); only http(s) or scheme-less relative paths are images.
  const nonHttpScheme =
    typeof candidate === "string" &&
    /^[a-z][a-z0-9+.-]*:/i.test(candidate) &&
    !/^https?:/i.test(candidate);
  const resolved = useAssetRef(nonHttpScheme ? undefined : candidate, filePath).src;
  return <image href={resolved} {...rest} />;
}
