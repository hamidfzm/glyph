const HTTP_URL = /https?:\/\/[^\s<>"'`()[\]]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

// The markdown pipeline percent-encodes an image URL before it reaches the
// component (micromark's normalizeUri). encodeURI keeps the same characters
// bare and differs only by also encoding "%", so valid escapes are restored.
function asRendered(url: string): string {
  return encodeURI(url).replace(/%25([0-9a-f]{2})/gi, "%$1");
}

/**
 * The http(s) URLs a document names, in the form the markdown renderer hands
 * an `img` component. A reply image whose URL is among them carries nothing
 * the document did not already carry.
 */
export function quotedImageUrls(markdown: string): string[] {
  const urls = new Set<string>();
  for (const match of markdown.match(HTTP_URL) ?? []) {
    urls.add(asRendered(match.replace(TRAILING_PUNCTUATION, "")));
  }
  return [...urls];
}
