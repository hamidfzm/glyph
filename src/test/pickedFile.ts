/** A file as a folder input reports it: `path` starts with the picked folder's own name. */
export function pickedFile(path: string, content = "image", lastModified = 1): File {
  const file = new File([content], path.slice(path.lastIndexOf("/") + 1), { lastModified });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}
