import { useCallback, type ComponentPropsWithoutRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

function resolveImageSrc(src: string | undefined, filePath: string | undefined): string | undefined {
  if (!src) return src;
  if (/^(https?:|data:)/i.test(src)) return src;
  if (filePath) {
    const dir = filePath.replace(/[/\\][^/\\]*$/, "");
    const resolved = `${dir}/${src}`.replace(/\/\.\//g, "/");
    return convertFileSrc(resolved);
  }
  return src;
}

export function useImageComponent(filePath: string | undefined) {
  return useCallback(
    (props: ComponentPropsWithoutRef<"img">) => {
      const { src, alt, ...rest } = props;
      return <img src={resolveImageSrc(src, filePath)} alt={alt} {...rest} />;
    },
    [filePath],
  );
}
