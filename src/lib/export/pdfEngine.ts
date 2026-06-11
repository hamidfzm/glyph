// Shared pdfmake bootstrap. The virtual font filesystem must be registered
// exactly once per session; both PDF builders (document and canvas board) go
// through this accessor so the flag lives in one place.

import pdfMake from "pdfmake/build/pdfmake";
import vfs from "pdfmake/build/vfs_fonts";

let registered = false;

export function pdfEngine(): typeof pdfMake {
  if (!registered) {
    pdfMake.addVirtualFileSystem(vfs);
    registered = true;
  }
  return pdfMake;
}
