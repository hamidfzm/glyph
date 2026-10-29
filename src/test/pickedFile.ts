/** A file as a folder input reports it: `path` starts with the picked folder's own name. */
export function pickedFile(path: string): File {
  const file = new File(["image"], path.slice(path.lastIndexOf("/") + 1));
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}
