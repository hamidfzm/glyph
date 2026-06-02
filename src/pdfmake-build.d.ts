// pdfmake's prebuilt browser bundles ship no type declarations of their own
// (@types/pdfmake only describes the package root, not the build/ subpaths we
// must import for a browser build). Declare the small surface we use.
declare module "pdfmake/build/pdfmake" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface CreatedPdf {
    getBuffer(): Promise<Uint8Array>;
  }
  interface PdfMake {
    addVirtualFileSystem(vfs: Record<string, string>): void;
    createPdf(documentDefinitions: TDocumentDefinitions): CreatedPdf;
  }
  const pdfMake: PdfMake;
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const vfs: Record<string, string>;
  export default vfs;
}
