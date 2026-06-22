export function countWords(text: string): number {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/[#*_~[\]()>|+-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 230));
}
