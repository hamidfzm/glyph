// Rasterization helpers for PDF export. Math is captured from the live DOM as
// rendered; Mermaid is re-rendered in the light theme so PDF diagrams are
// always light (the on-screen SVG bakes in the app theme's colors).

let mermaidId = 0;

// Rasterize a live element (e.g. block math) to a PNG data URI via html2canvas.
export async function rasterizeElement(el: HTMLElement, backgroundColor: string): Promise<string> {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, { backgroundColor, scale: 2, logging: false });
  return canvas.toDataURL("image/png");
}

// Re-render a Mermaid source in the light theme with SVG text labels (no
// `<foreignObject>`, which would taint the canvas), and rasterize to a PNG on a
// white background. Always light, regardless of the app theme.
export async function rasterizeMermaidLight(source: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, theme: "default", flowchart: { htmlLabels: false } });
  const { svg } = await mermaid.render(`glyph-export-mermaid-${mermaidId++}`, source);
  return svgToPng(svg);
}

// Restore Mermaid's (global) config to the app theme after export-time renders,
// so on-screen diagrams keep their theme and HTML labels.
export async function restoreMermaidTheme(dark: boolean): Promise<void> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    flowchart: { htmlLabels: true },
  });
}

function svgToPng(svg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const w = image.naturalWidth || 800;
      const h = image.naturalHeight || 600;
      const canvas = document.createElement("canvas");
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("no 2d context"));
        return;
      }
      ctx.scale(2, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg load failed"));
    };
    image.src = url;
  });
}
