import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import { FencedMountSlot } from "@/components/plugins/FencedMountSlot";
import type { FencedBlock } from "@/lib/fencedBlockEdit";
import { isFencedRendererMount } from "@/lib/plugins/fencedRenderers";
import type { FencedRendererContribution } from "@/lib/plugins/types";

interface PluginFencedBlockProps {
  renderer: FencedRendererContribution;
  code: string;
  /** The block's source lines, fences included; absent when the pipeline lost them. */
  startLine?: number;
  endLine?: number;
  openLightbox?: (src: string, label: string) => void;
  onFencedBlockEdit?: (block: FencedBlock, code: string) => Promise<boolean>;
}

/** A fenced block drawn by the plugin renderer registered for its language. */
export function PluginFencedBlock({
  renderer,
  code,
  startLine,
  endLine,
  openLightbox,
  onFencedBlockEdit,
}: PluginFencedBlockProps) {
  // Where the block is now, or null once it is gone, so a save started from an
  // older render (an editor left open) refuses instead of landing elsewhere.
  const linesRef = useRef<{ startLine: number; endLine: number } | null>(null);
  useLayoutEffect(() => {
    if (startLine !== undefined && endLine !== undefined) linesRef.current = { startLine, endLine };
  }, [startLine, endLine]);
  useLayoutEffect(
    () => () => {
      linesRef.current = null;
    },
    [],
  );

  // The code is the render's own, so a save checks the text against what this
  // render showed. The lines come from the ref: text typed above the block
  // moves it without mounting the renderer again.
  const hasPosition = startLine !== undefined && endLine !== undefined;
  const updateCode = useMemo(() => {
    if (!onFencedBlockEdit || !hasPosition) return undefined;
    return async (next: string) => {
      const lines = linesRef.current;
      return lines ? onFencedBlockEdit({ ...lines, code }, next) : false;
    };
  }, [onFencedBlockEdit, hasPosition, code]);

  let rendered: ReactNode;
  if (isFencedRendererMount(renderer.render)) {
    rendered = (
      <FencedMountSlot
        renderer={renderer.render}
        code={code}
        openLightbox={openLightbox}
        updateCode={updateCode}
      />
    );
  } else {
    const Render = renderer.render;
    rendered = <Render code={code} openLightbox={openLightbox} updateCode={updateCode} />;
  }
  // Print and PDF export find the block by these to re-render it through the
  // plugin's renderStatic.
  return (
    <div data-fenced-language={renderer.language} data-fenced-source={code}>
      {rendered}
    </div>
  );
}
