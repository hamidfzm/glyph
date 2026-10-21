// The schemes a document or canvas may hand to the opener, behind the
// external-link prompt; the opener's own scope allows the same four.
const EXTERNAL_SCHEME = /^(https?|mailto|tel):/i;

export function isExternalLinkUrl(url: string): boolean {
  return EXTERNAL_SCHEME.test(url.trim());
}
