import { useAssetRef } from "@/hooks/useAssetRef";
import { basename } from "@/lib/paths";

interface CanvasImageNodeProps {
  file: string;
  canvasPath: string | undefined;
}

// An image file card. Until its src resolves (refused by the workspace clamp,
// or still waiting on the backend beside a loose canvas) it shows the file name.
export function CanvasImageNode({ file, canvasPath }: CanvasImageNodeProps) {
  const { src } = useAssetRef(file, canvasPath);
  if (!src) {
    return (
      <div className="glyph-canvas-node-file" title={file}>
        <span className="glyph-canvas-node-file-name">{basename(file)}</span>
      </div>
    );
  }
  return <img className="glyph-canvas-node-image" src={src} alt={basename(file)} />;
}
