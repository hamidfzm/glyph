// Deterministic hue (0 to 359) from a tag string. The same hash as the app's
// rendered frontmatter tags (src/lib/tagColor.ts), so a tag keeps one colour
// app-wide; src/lib/tagColor.test.ts pins the two together.
export function tagHue(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
