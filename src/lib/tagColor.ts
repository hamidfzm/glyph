// Deterministic 0–359 hue from a tag string. Same tag always lands on the same
// colour across documents — and across the future tag-search view (issue #108).
export function tagHue(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
